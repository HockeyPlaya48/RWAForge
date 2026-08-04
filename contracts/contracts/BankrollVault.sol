// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPredictionMarketBet {
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
    function bet(uint256 marketId, bool isYes, uint256 amount) external;
    function betETH(uint256 marketId, bool isYes) external payable;
    function claimWinnings(uint256 marketId) external;
    function previewPayout(uint256 marketId, address user) external view returns (uint256);
}

interface IComboMarketBet {
    enum Outcome { Unresolved, Yes, No, Cancelled }

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
        );
    function betCombo(uint256 comboId, bool isYes, uint256 amount) external;
    function betComboETH(uint256 comboId, bool isYes) external payable;
    function claimComboWinnings(uint256 comboId) external;
    function previewComboPayout(uint256 comboId, address user) external view returns (uint256);
}

/// @title RWAForge BankrollVault
/// @notice A bounded, same-asset liquidity backstop ("Option A"). When a market or
///         combo's pool is thinner than a configured threshold, anyone can trigger
///         the vault to top up the genuinely thin side with a small amount of that
///         market's own collateral - no swaps, no cross-asset conversion, no
///         fixed-odds promise to any user. The vault is just another pari-mutuel
///         participant: if its top-up loses, it loses exactly what it staked and
///         nothing more; there's no way for it to owe a user more than it put in.
///
///         Every top-up is bounded by:
///           - a per-market cap (how much the vault will ever have staked in one market)
///           - a global cap per collateral token (how much the vault will have "at risk"
///             across every open position at once)
///           - a floor balance per token (a circuit breaker - the vault refuses new
///             top-ups that would drop its available balance below this floor)
///         The vault only ever bets on whichever side is currently smaller - it cannot
///         be used to inflate one side arbitrarily.
contract BankrollVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant ETH_SENTINEL = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);

    IPredictionMarketBet public immutable predictionMarket;
    IComboMarketBet public immutable comboMarket;

    bool public paused;

    mapping(address => uint256) public perMarketCap; // token => max ever staked in one market
    mapping(address => uint256) public globalCap; // token => max total at-risk across all open positions
    mapping(address => uint256) public minDepthThreshold; // token => pool total below which top-up is allowed
    mapping(address => uint256) public floorBalance; // token => circuit-breaker floor for available balance
    mapping(address => uint256) public totalDeployed; // token => currently at-risk (unresolved) capital

    mapping(uint256 => uint256) public pmStaked; // marketId => vault's total staked (unresolved)
    mapping(uint256 => uint256) public comboStaked; // comboId => vault's total staked (unresolved)

    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event ToppedUpMarket(uint256 indexed marketId, bool isYes, uint256 amount, address token);
    event ToppedUpCombo(uint256 indexed comboId, bool isYes, uint256 amount, address token);
    event MarketSettled(uint256 indexed marketId, uint256 staked, uint256 received);
    event ComboSettled(uint256 indexed comboId, uint256 staked, uint256 received);
    event Paused(bool paused);
    event CapsUpdated(address indexed token, uint256 perMarketCap, uint256 globalCap, uint256 minDepthThreshold, uint256 floorBalance);

    error VaultPaused();
    error ZeroAmount();
    error ZeroAddress();
    error PoolNotThin();
    error NotTheThinSide();
    error PerMarketCapExceeded();
    error GlobalCapExceeded();
    error CircuitBreakerFloor();
    error NothingStaked();
    error MarketNotResolved();

    modifier whenNotPaused() {
        if (paused) revert VaultPaused();
        _;
    }

    constructor(address initialOwner, address predictionMarket_, address comboMarket_) Ownable(initialOwner) {
        if (predictionMarket_ == address(0) || comboMarket_ == address(0)) revert ZeroAddress();
        predictionMarket = IPredictionMarketBet(predictionMarket_);
        comboMarket = IComboMarketBet(comboMarket_);
    }

    // ── Funding ──────────────────────────────────────────────────────────────

    receive() external payable {
        emit Deposited(ETH_SENTINEL, msg.value);
    }

    /// @notice Record an ERC-20 deposit already sent to this contract (informational - a
    ///         plain transfer works too, this just emits a matching event for indexers).
    function notifyDeposit(address token, uint256 amount) external {
        emit Deposited(token, amount);
    }

    // ── Top-ups ──────────────────────────────────────────────────────────────

    /// @notice Top up the thin side of a PredictionMarket market with ERC-20 collateral.
    function topUpMarket(uint256 marketId, bool isYes, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        IPredictionMarketBet.Market memory m = predictionMarket.getMarket(marketId);
        require(m.collateralToken != ETH_SENTINEL, "use topUpMarketETH");
        _checkThinAndCaps(m.collateralToken, m.yesPool, m.noPool, isYes, pmStaked[marketId], amount);

        IERC20(m.collateralToken).forceApprove(address(predictionMarket), amount);
        predictionMarket.bet(marketId, isYes, amount);

        pmStaked[marketId] += amount;
        totalDeployed[m.collateralToken] += amount;
        emit ToppedUpMarket(marketId, isYes, amount, m.collateralToken);
    }

    /// @notice Top up the thin side of a PredictionMarket market with native ETH.
    function topUpMarketETH(uint256 marketId, bool isYes, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        IPredictionMarketBet.Market memory m = predictionMarket.getMarket(marketId);
        require(m.collateralToken == ETH_SENTINEL, "use topUpMarket");
        _checkThinAndCaps(ETH_SENTINEL, m.yesPool, m.noPool, isYes, pmStaked[marketId], amount);

        predictionMarket.betETH{value: amount}(marketId, isYes);

        pmStaked[marketId] += amount;
        totalDeployed[ETH_SENTINEL] += amount;
        emit ToppedUpMarket(marketId, isYes, amount, ETH_SENTINEL);
    }

    /// @notice Top up the thin side of a ComboMarket parlay with ERC-20 collateral.
    function topUpCombo(uint256 comboId, bool isYes, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        (, , address collateralToken, , uint256 yesPool, uint256 noPool, , ) = comboMarket.getCombo(comboId);
        require(collateralToken != ETH_SENTINEL, "use topUpComboETH");
        _checkThinAndCaps(collateralToken, yesPool, noPool, isYes, comboStaked[comboId], amount);

        IERC20(collateralToken).forceApprove(address(comboMarket), amount);
        comboMarket.betCombo(comboId, isYes, amount);

        comboStaked[comboId] += amount;
        totalDeployed[collateralToken] += amount;
        emit ToppedUpCombo(comboId, isYes, amount, collateralToken);
    }

    /// @notice Top up the thin side of a ComboMarket parlay with native ETH.
    function topUpComboETH(uint256 comboId, bool isYes, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        (, , address collateralToken, , uint256 yesPool, uint256 noPool, , ) = comboMarket.getCombo(comboId);
        require(collateralToken == ETH_SENTINEL, "use topUpCombo");
        _checkThinAndCaps(ETH_SENTINEL, yesPool, noPool, isYes, comboStaked[comboId], amount);

        comboMarket.betComboETH{value: amount}(comboId, isYes);

        comboStaked[comboId] += amount;
        totalDeployed[ETH_SENTINEL] += amount;
        emit ToppedUpCombo(comboId, isYes, amount, ETH_SENTINEL);
    }

    function _checkThinAndCaps(
        address token,
        uint256 yesPool,
        uint256 noPool,
        bool isYes,
        uint256 alreadyStaked,
        uint256 amount
    ) internal view {
        uint256 total = yesPool + noPool;
        if (total >= minDepthThreshold[token]) revert PoolNotThin();

        uint256 sidePool = isYes ? yesPool : noPool;
        uint256 otherPool = isYes ? noPool : yesPool;
        if (sidePool > otherPool) revert NotTheThinSide();

        if (alreadyStaked + amount > perMarketCap[token]) revert PerMarketCapExceeded();
        if (totalDeployed[token] + amount > globalCap[token]) revert GlobalCapExceeded();

        uint256 available = token == ETH_SENTINEL ? address(this).balance : IERC20(token).balanceOf(address(this));
        if (available < amount) revert ZeroAmount();
        if (available - amount < floorBalance[token]) revert CircuitBreakerFloor();
    }

    // ── Settlement ───────────────────────────────────────────────────────────

    /// @notice Claim (or release, if lost) the vault's position in a resolved market, freeing up its exposure.
    function settleMarket(uint256 marketId) external nonReentrant {
        uint256 staked = pmStaked[marketId];
        if (staked == 0) revert NothingStaked();
        IPredictionMarketBet.Market memory m = predictionMarket.getMarket(marketId);
        if (m.outcome == IPredictionMarketBet.Outcome.Unresolved) revert MarketNotResolved();

        uint256 payout = predictionMarket.previewPayout(marketId, address(this));
        if (payout > 0) predictionMarket.claimWinnings(marketId);

        pmStaked[marketId] = 0;
        totalDeployed[m.collateralToken] -= staked;
        emit MarketSettled(marketId, staked, payout);
    }

    /// @notice Claim (or release, if lost) the vault's position in a resolved combo, freeing up its exposure.
    function settleCombo(uint256 comboId) external nonReentrant {
        uint256 staked = comboStaked[comboId];
        if (staked == 0) revert NothingStaked();
        (, , address collateralToken, , , , IComboMarketBet.Outcome outcome, ) = comboMarket.getCombo(comboId);
        if (outcome == IComboMarketBet.Outcome.Unresolved) revert MarketNotResolved();

        uint256 payout = comboMarket.previewComboPayout(comboId, address(this));
        if (payout > 0) comboMarket.claimComboWinnings(comboId);

        comboStaked[comboId] = 0;
        totalDeployed[collateralToken] -= staked;
        emit ComboSettled(comboId, staked, payout);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setCaps(
        address token,
        uint256 perMarketCap_,
        uint256 globalCap_,
        uint256 minDepthThreshold_,
        uint256 floorBalance_
    ) external onlyOwner {
        perMarketCap[token] = perMarketCap_;
        globalCap[token] = globalCap_;
        minDepthThreshold[token] = minDepthThreshold_;
        floorBalance[token] = floorBalance_;
        emit CapsUpdated(token, perMarketCap_, globalCap_, minDepthThreshold_, floorBalance_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit Paused(paused_);
    }

    /// @notice Emergency withdrawal, e.g. to retire the vault or rebalance reserves. Only reduces
    ///         idle balance - funds already staked into an open market/combo aren't reachable
    ///         here until settleMarket/settleCombo brings them back.
    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (token == ETH_SENTINEL) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdrawn(token, amount, to);
    }
}
