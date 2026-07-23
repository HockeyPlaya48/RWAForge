// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RWAForge PredictionMarket
/// @notice Native binary prediction market on Robinhood Chain.
///         Accepts any ERC-20 (tokenized stocks, USGD, FORGE) or native ETH as collateral.
///         Pool-based: YES pool + NO pool. Winners split the total pool proportionally.
///         A protocol fee (default 2%) is taken from the winning pool and sent to feeRecipient.
///
///         Anyone can create a market (permissionless). Operator/owner resolves via
///         oracle or manual determination. No AMM — pure pool betting.
contract PredictionMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE_BPS = 500; // 5% hard cap
    address public constant ETH_SENTINEL = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    enum Outcome { Unresolved, Yes, No, Cancelled }

    struct Market {
        string question;
        address collateralToken; // ERC-20 address, or ETH_SENTINEL for native ETH
        uint256 endTime;
        uint256 yesPool;
        uint256 noPool;
        Outcome outcome;
        address creator;
    }

    address public feeRecipient;
    uint256 public feeBps = 200; // 2%
    address public resolver;

    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;

    // marketId => user => yes bet
    mapping(uint256 => mapping(address => uint256)) public yesBets;
    // marketId => user => no bet
    mapping(uint256 => mapping(address => uint256)) public noBets;
    // marketId => user => claimed
    mapping(uint256 => mapping(address => bool)) public claimed;

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        string question,
        address collateralToken,
        uint256 endTime
    );
    event BetPlaced(
        uint256 indexed marketId,
        address indexed user,
        bool isYes,
        uint256 amount
    );
    event MarketResolved(uint256 indexed marketId, Outcome outcome);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event MarketCancelled(uint256 indexed marketId);

    error MarketNotFound(uint256 marketId);
    error MarketAlreadyResolved(uint256 marketId);
    error MarketNotResolved(uint256 marketId);
    error MarketExpired(uint256 marketId);
    error MarketNotExpired(uint256 marketId);
    error AlreadyClaimed(uint256 marketId);
    error NothingToClaim(uint256 marketId);
    error NotResolver();
    error ZeroAmount();
    error ZeroAddress();
    error FeeOutOfBounds();
    error WrongETHAmount();

    modifier onlyResolver() {
        if (msg.sender != resolver && msg.sender != owner()) revert NotResolver();
        _;
    }

    constructor(address initialOwner, address resolver_, address feeRecipient_)
        Ownable(initialOwner)
    {
        if (resolver_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        resolver = resolver_;
        feeRecipient = feeRecipient_;
    }

    // ── Market creation ──────────────────────────────────────────────────────

    /// @notice Create a binary prediction market.
    /// @param question       The yes/no question.
    /// @param collateralToken ERC-20 to use as collateral, or ETH_SENTINEL for native ETH.
    /// @param endTime        Unix timestamp after which no more bets are accepted.
    function createMarket(
        string calldata question,
        address collateralToken,
        uint256 endTime
    ) external returns (uint256 marketId) {
        require(endTime > block.timestamp, "endTime must be future");
        require(bytes(question).length > 0, "empty question");

        marketId = nextMarketId++;
        markets[marketId] = Market({
            question: question,
            collateralToken: collateralToken,
            endTime: endTime,
            yesPool: 0,
            noPool: 0,
            outcome: Outcome.Unresolved,
            creator: msg.sender
        });

        emit MarketCreated(marketId, msg.sender, question, collateralToken, endTime);
    }

    // ── Betting ──────────────────────────────────────────────────────────────

    /// @notice Bet on a market with an ERC-20 token.
    /// @param marketId Market to bet on.
    /// @param isYes    true = YES side, false = NO side.
    /// @param amount   Amount of collateral token to bet.
    function bet(uint256 marketId, bool isYes, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Market storage m = markets[marketId];
        if (m.endTime == 0) revert MarketNotFound(marketId);
        if (m.outcome != Outcome.Unresolved) revert MarketAlreadyResolved(marketId);
        if (block.timestamp >= m.endTime) revert MarketExpired(marketId);
        require(m.collateralToken != ETH_SENTINEL, "use betETH for native ETH markets");

        IERC20(m.collateralToken).safeTransferFrom(msg.sender, address(this), amount);
        _recordBet(marketId, msg.sender, isYes, amount);
    }

    /// @notice Bet on a native ETH market.
    /// @param marketId Market to bet on (must have collateralToken == ETH_SENTINEL).
    /// @param isYes    true = YES side, false = NO side.
    function betETH(uint256 marketId, bool isYes) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        Market storage m = markets[marketId];
        if (m.endTime == 0) revert MarketNotFound(marketId);
        if (m.outcome != Outcome.Unresolved) revert MarketAlreadyResolved(marketId);
        if (block.timestamp >= m.endTime) revert MarketExpired(marketId);
        require(m.collateralToken == ETH_SENTINEL, "use bet() for ERC-20 markets");

        _recordBet(marketId, msg.sender, isYes, msg.value);
    }

    function _recordBet(uint256 marketId, address user, bool isYes, uint256 amount) internal {
        Market storage m = markets[marketId];
        if (isYes) {
            yesBets[marketId][user] += amount;
            m.yesPool += amount;
        } else {
            noBets[marketId][user] += amount;
            m.noPool += amount;
        }
        emit BetPlaced(marketId, user, isYes, amount);
    }

    // ── Resolution ───────────────────────────────────────────────────────────

    /// @notice Resolve a market. Callable by resolver or owner.
    /// @param marketId  Market to resolve.
    /// @param yesWon   true if YES outcome won.
    function resolveMarket(uint256 marketId, bool yesWon) external onlyResolver {
        Market storage m = markets[marketId];
        if (m.endTime == 0) revert MarketNotFound(marketId);
        if (m.outcome != Outcome.Unresolved) revert MarketAlreadyResolved(marketId);

        m.outcome = yesWon ? Outcome.Yes : Outcome.No;
        emit MarketResolved(marketId, m.outcome);
    }

    /// @notice Cancel a market and allow all bettors to claim refunds.
    function cancelMarket(uint256 marketId) external onlyResolver {
        Market storage m = markets[marketId];
        if (m.endTime == 0) revert MarketNotFound(marketId);
        if (m.outcome != Outcome.Unresolved) revert MarketAlreadyResolved(marketId);
        m.outcome = Outcome.Cancelled;
        emit MarketCancelled(marketId);
    }

    // ── Claims ───────────────────────────────────────────────────────────────

    /// @notice Claim winnings (or refund if cancelled) from a resolved market.
    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage m = markets[marketId];
        if (m.endTime == 0) revert MarketNotFound(marketId);
        if (m.outcome == Outcome.Unresolved) revert MarketNotResolved(marketId);
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed(marketId);

        claimed[marketId][msg.sender] = true;

        uint256 payout = _computePayout(marketId, msg.sender);
        if (payout == 0) revert NothingToClaim(marketId);

        emit WinningsClaimed(marketId, msg.sender, payout);

        if (m.collateralToken == ETH_SENTINEL) {
            (bool ok,) = msg.sender.call{value: payout}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20(m.collateralToken).safeTransfer(msg.sender, payout);
        }
    }

    function _computePayout(uint256 marketId, address user) internal view returns (uint256) {
        Market storage m = markets[marketId];

        if (m.outcome == Outcome.Cancelled) {
            return yesBets[marketId][user] + noBets[marketId][user];
        }

        uint256 userWinningBet;
        uint256 winningPool;

        if (m.outcome == Outcome.Yes) {
            userWinningBet = yesBets[marketId][user];
            winningPool = m.yesPool;
        } else {
            userWinningBet = noBets[marketId][user];
            winningPool = m.noPool;
        }

        if (userWinningBet == 0 || winningPool == 0) return 0;

        uint256 totalPool = m.yesPool + m.noPool;
        uint256 fee = (totalPool * feeBps) / BPS_DENOMINATOR;
        uint256 payablePool = totalPool - fee;

        return (userWinningBet * payablePool) / winningPool;
    }

    /// @notice Preview payout for a user on a resolved market (before claiming).
    function previewPayout(uint256 marketId, address user) external view returns (uint256) {
        return _computePayout(marketId, user);
    }

    /// @notice Collect protocol fees (accumulated during resolutions).
    /// @dev Fee stays in contract until swept; only sweep after all claims are likely done.
    function sweepFees(uint256 marketId) external onlyOwner {
        Market storage m = markets[marketId];
        if (m.outcome == Outcome.Unresolved || m.outcome == Outcome.Cancelled) return;

        uint256 totalPool = m.yesPool + m.noPool;
        uint256 fee = (totalPool * feeBps) / BPS_DENOMINATOR;

        if (m.collateralToken == ETH_SENTINEL) {
            (bool ok,) = feeRecipient.call{value: fee}("");
            require(ok, "ETH fee transfer failed");
        } else {
            IERC20(m.collateralToken).safeTransfer(feeRecipient, fee);
        }
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setResolver(address newResolver) external onlyOwner {
        if (newResolver == address(0)) revert ZeroAddress();
        resolver = newResolver;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeOutOfBounds();
        feeBps = bps;
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    receive() external payable {}
}
