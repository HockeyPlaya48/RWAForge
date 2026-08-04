// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPredictionMarketView {
    enum Outcome { Unresolved, Yes, No, Cancelled }

    struct Market {
        string question;
        address collateralToken;
        uint256 endTime;
        uint256 yesPool;
        uint256 noPool;
        Outcome outcome;
        address creator;
    }

    function getMarket(uint256 marketId) external view returns (Market memory);
}

/// @title RWAForge ComboMarket
/// @notice Parlay betting on top of PredictionMarket: a combo bundles 2+ existing
///         markets ("legs") into a single YES/NO proposition — "do all legs resolve
///         exactly as picked?" Pool-based and pari-mutuel, same as PredictionMarket,
///         so payout is entirely funded by what's staked into that combo's own pool.
///         No bankroll, no fixed-odds underwriting by the protocol.
///
///         Resolution is permissionless and mechanical: once every referenced leg has
///         been resolved on PredictionMarket, anyone can call resolveCombo() to settle
///         this combo by reading those outcomes. This contract never resolves a leg
///         itself and never writes to PredictionMarket.
contract ComboMarket is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_FEE_BPS = 500; // 5% hard cap
    uint256 public constant MIN_LEGS = 2;
    uint256 public constant MAX_LEGS = 10; // bounds gas in resolveCombo's loop
    address public constant ETH_SENTINEL = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    enum Outcome { Unresolved, Yes, No, Cancelled }

    struct Combo {
        uint256[] legMarketIds;
        bool[] legPicks; // pick per leg: true = that leg's YES side, false = NO side
        address collateralToken;
        uint256 endTime; // betting cutoff; must be <= every leg's own endTime
        uint256 yesPool; // staked on "all legs hit as picked"
        uint256 noPool; // staked on "at least one leg misses"
        Outcome outcome;
        address creator;
    }

    IPredictionMarketView public immutable predictionMarket;

    address public feeRecipient;
    uint256 public feeBps = 200; // 2%

    uint256 public nextComboId;
    mapping(uint256 => Combo) private combos;

    mapping(uint256 => mapping(address => uint256)) public yesBets;
    mapping(uint256 => mapping(address => uint256)) public noBets;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event ComboCreated(
        uint256 indexed comboId,
        address indexed creator,
        uint256[] legMarketIds,
        bool[] legPicks,
        address collateralToken,
        uint256 endTime
    );
    event ComboBetPlaced(uint256 indexed comboId, address indexed user, bool isYes, uint256 amount);
    event ComboResolved(uint256 indexed comboId, Outcome outcome);
    event ComboWinningsClaimed(uint256 indexed comboId, address indexed user, uint256 amount);

    error ComboNotFound(uint256 comboId);
    error ComboAlreadyResolved(uint256 comboId);
    error ComboNotResolved(uint256 comboId);
    error ComboExpired(uint256 comboId);
    error LegsNotResolved(uint256 comboId);
    error AlreadyClaimed(uint256 comboId);
    error NothingToClaim(uint256 comboId);
    error ZeroAmount();
    error ZeroAddress();
    error FeeOutOfBounds();
    error TooFewLegs();
    error TooManyLegs();
    error LegPickLengthMismatch();
    error LegMarketNotFound(uint256 marketId);
    error LegAlreadyResolved(uint256 marketId);
    error LegEndsAfterCombo(uint256 marketId);
    error WrongETHAmount();

    constructor(address initialOwner, address predictionMarket_, address feeRecipient_) Ownable(initialOwner) {
        if (predictionMarket_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        predictionMarket = IPredictionMarketView(predictionMarket_);
        feeRecipient = feeRecipient_;
    }

    // ── Combo creation ───────────────────────────────────────────────────────

    /// @notice Create a parlay combo from 2-10 existing, still-open PredictionMarket legs.
    /// @param legMarketIds  PredictionMarket market ids to bundle.
    /// @param legPicks      Per-leg pick: true bets that leg's YES side, false its NO side.
    /// @param collateralToken Collateral for the combo itself (independent of each leg's own collateral).
    /// @param endTime       Betting cutoff for the combo; must be <= every leg's own endTime,
    ///                      so nobody can build a combo around a leg that's already closed for betting.
    function createCombo(
        uint256[] calldata legMarketIds,
        bool[] calldata legPicks,
        address collateralToken,
        uint256 endTime
    ) external returns (uint256 comboId) {
        if (legMarketIds.length != legPicks.length) revert LegPickLengthMismatch();
        if (legMarketIds.length < MIN_LEGS) revert TooFewLegs();
        if (legMarketIds.length > MAX_LEGS) revert TooManyLegs();
        require(endTime > block.timestamp, "endTime must be future");

        for (uint256 i = 0; i < legMarketIds.length; i++) {
            IPredictionMarketView.Market memory leg = predictionMarket.getMarket(legMarketIds[i]);
            if (leg.endTime == 0) revert LegMarketNotFound(legMarketIds[i]);
            if (leg.outcome != IPredictionMarketView.Outcome.Unresolved) revert LegAlreadyResolved(legMarketIds[i]);
            if (leg.endTime < endTime) revert LegEndsAfterCombo(legMarketIds[i]);
        }

        comboId = nextComboId++;
        Combo storage c = combos[comboId];
        c.legMarketIds = legMarketIds;
        c.legPicks = legPicks;
        c.collateralToken = collateralToken;
        c.endTime = endTime;
        c.outcome = Outcome.Unresolved;
        c.creator = msg.sender;

        emit ComboCreated(comboId, msg.sender, legMarketIds, legPicks, collateralToken, endTime);
    }

    // ── Betting ──────────────────────────────────────────────────────────────

    function betCombo(uint256 comboId, bool isYes, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Combo storage c = combos[comboId];
        if (c.endTime == 0) revert ComboNotFound(comboId);
        if (c.outcome != Outcome.Unresolved) revert ComboAlreadyResolved(comboId);
        if (block.timestamp >= c.endTime) revert ComboExpired(comboId);
        require(c.collateralToken != ETH_SENTINEL, "use betComboETH for native ETH combos");

        IERC20(c.collateralToken).safeTransferFrom(msg.sender, address(this), amount);
        _recordBet(comboId, msg.sender, isYes, amount);
    }

    function betComboETH(uint256 comboId, bool isYes) external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        Combo storage c = combos[comboId];
        if (c.endTime == 0) revert ComboNotFound(comboId);
        if (c.outcome != Outcome.Unresolved) revert ComboAlreadyResolved(comboId);
        if (block.timestamp >= c.endTime) revert ComboExpired(comboId);
        require(c.collateralToken == ETH_SENTINEL, "use betCombo for ERC-20 combos");

        _recordBet(comboId, msg.sender, isYes, msg.value);
    }

    function _recordBet(uint256 comboId, address user, bool isYes, uint256 amount) internal {
        Combo storage c = combos[comboId];
        if (isYes) {
            yesBets[comboId][user] += amount;
            c.yesPool += amount;
        } else {
            noBets[comboId][user] += amount;
            c.noPool += amount;
        }
        emit ComboBetPlaced(comboId, user, isYes, amount);
    }

    // ── Resolution ───────────────────────────────────────────────────────────

    /// @notice Settle a combo once every leg has resolved on PredictionMarket. Permissionless —
    ///         the outcome is mechanically derived, so there's nothing for an operator to decide.
    ///         If any leg was cancelled, the whole combo is cancelled (refund) since a fair
    ///         all-legs-hit determination isn't possible.
    function resolveCombo(uint256 comboId) external {
        Combo storage c = combos[comboId];
        if (c.endTime == 0) revert ComboNotFound(comboId);
        if (c.outcome != Outcome.Unresolved) revert ComboAlreadyResolved(comboId);

        bool allHit = true;
        for (uint256 i = 0; i < c.legMarketIds.length; i++) {
            IPredictionMarketView.Market memory leg = predictionMarket.getMarket(c.legMarketIds[i]);
            if (leg.outcome == IPredictionMarketView.Outcome.Unresolved) revert LegsNotResolved(comboId);
            if (leg.outcome == IPredictionMarketView.Outcome.Cancelled) {
                c.outcome = Outcome.Cancelled;
                emit ComboResolved(comboId, c.outcome);
                return;
            }
            bool legHit = (leg.outcome == IPredictionMarketView.Outcome.Yes && c.legPicks[i])
                || (leg.outcome == IPredictionMarketView.Outcome.No && !c.legPicks[i]);
            if (!legHit) allHit = false;
        }

        c.outcome = allHit ? Outcome.Yes : Outcome.No;
        emit ComboResolved(comboId, c.outcome);
    }

    // ── Claims ───────────────────────────────────────────────────────────────

    function claimComboWinnings(uint256 comboId) external nonReentrant {
        Combo storage c = combos[comboId];
        if (c.endTime == 0) revert ComboNotFound(comboId);
        if (c.outcome == Outcome.Unresolved) revert ComboNotResolved(comboId);
        if (claimed[comboId][msg.sender]) revert AlreadyClaimed(comboId);

        claimed[comboId][msg.sender] = true;

        uint256 payout = _computePayout(comboId, msg.sender);
        if (payout == 0) revert NothingToClaim(comboId);

        emit ComboWinningsClaimed(comboId, msg.sender, payout);

        if (c.collateralToken == ETH_SENTINEL) {
            (bool ok,) = msg.sender.call{value: payout}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20(c.collateralToken).safeTransfer(msg.sender, payout);
        }
    }

    function _computePayout(uint256 comboId, address user) internal view returns (uint256) {
        Combo storage c = combos[comboId];

        if (c.outcome == Outcome.Cancelled) {
            return yesBets[comboId][user] + noBets[comboId][user];
        }

        uint256 userWinningBet;
        uint256 winningPool;

        if (c.outcome == Outcome.Yes) {
            userWinningBet = yesBets[comboId][user];
            winningPool = c.yesPool;
        } else {
            userWinningBet = noBets[comboId][user];
            winningPool = c.noPool;
        }

        if (userWinningBet == 0 || winningPool == 0) return 0;

        uint256 totalPool = c.yesPool + c.noPool;
        uint256 fee = (totalPool * feeBps) / BPS_DENOMINATOR;
        uint256 payablePool = totalPool - fee;

        return (userWinningBet * payablePool) / winningPool;
    }

    /// @notice Preview payout for a user on a resolved combo (before claiming).
    function previewComboPayout(uint256 comboId, address user) external view returns (uint256) {
        return _computePayout(comboId, user);
    }

    /// @notice Collect protocol fees (accumulated during resolutions).
    function sweepComboFees(uint256 comboId) external onlyOwner {
        Combo storage c = combos[comboId];
        if (c.outcome == Outcome.Unresolved || c.outcome == Outcome.Cancelled) return;

        uint256 totalPool = c.yesPool + c.noPool;
        uint256 fee = (totalPool * feeBps) / BPS_DENOMINATOR;

        if (c.collateralToken == ETH_SENTINEL) {
            (bool ok,) = feeRecipient.call{value: fee}("");
            require(ok, "ETH fee transfer failed");
        } else {
            IERC20(c.collateralToken).safeTransfer(feeRecipient, fee);
        }
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newRecipient;
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeOutOfBounds();
        feeBps = bps;
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getCombo(uint256 comboId)
        external
        view
        returns (
            uint256[] memory legMarketIds,
            bool[] memory legPicks,
            address collateralToken,
            uint256 endTime,
            uint256 yesPool,
            uint256 noPool,
            Outcome outcome,
            address creator
        )
    {
        Combo storage c = combos[comboId];
        return (c.legMarketIds, c.legPicks, c.collateralToken, c.endTime, c.yesPool, c.noPool, c.outcome, c.creator);
    }

    receive() external payable {}
}
