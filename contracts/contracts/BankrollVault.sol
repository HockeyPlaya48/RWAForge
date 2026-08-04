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
    function feeBps() external view returns (uint256);
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
    function feeBps() external view returns (uint256);
}

/// @title RWAForge BankrollVault
/// @notice A bounded, same-asset liquidity backstop ("Option A"). The vault is just
///         another pari-mutuel participant - it never promises anyone a payout, so
///         its worst case is exactly what it stakes and nothing more. No swaps, no
///         cross-asset conversion.
///
///         Sizing is formulaic and deliberately modest, not "fill the pool":
///         given a market's current thin/heavy pools, the vault computes how much
///         the THIN side would need to reach a target payout multiplier (e.g. 1.3x)
///         for someone betting a reference amount on the HEAVY (popular) side - that's
///         the side most people actually want to bet, and the one that pays garbage
///         when the market is lopsided. The vault then contributes only a fraction
///         (e.g. 30%) of that gap, so it takes a partial step toward a modest,
///         sustainable payout rather than fully funding a generous one.
///
///         Every top-up is additionally bounded by:
///           - a per-market cap (how much the vault will ever have staked in one market)
///           - a global cap per collateral token (how much the vault will have "at risk"
///             across every open position at once)
///           - a floor balance per token (a circuit breaker - the vault refuses new
///             top-ups that would drop its available balance below this floor)
///           - a coarse min-depth gate (only markets/combos below this much total
///             volume are eligible at all, regardless of what the formula says)
///         The vault only ever bets on whichever side is currently smaller - it cannot
///         be used to inflate one side arbitrarily.
contract BankrollVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant ETH_SENTINEL = address(0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE);
    uint256 public constant BPS_DENOMINATOR = 10_000;

    IPredictionMarketBet public immutable predictionMarket;
    IComboMarketBet public immutable comboMarket;

    bool public paused;

    // ── Risk caps (per collateral token) ────────────────────────────────────
    mapping(address => uint256) public perMarketCap; // max ever staked in one market
    mapping(address => uint256) public globalCap; // max total at-risk across all open positions
    mapping(address => uint256) public minDepthThreshold; // pool total below which top-up is eligible at all
    mapping(address => uint256) public floorBalance; // circuit-breaker floor for available balance
    mapping(address => uint256) public totalDeployed; // currently at-risk (unresolved) capital

    // ── Pricing params (per collateral token) ───────────────────────────────
    mapping(address => uint256) public targetMultiplierBps; // e.g. 13000 = aim for 1.30x on the heavy side
    mapping(address => uint256) public referenceBetSize; // "typical" bet size the target multiplier is computed for
    mapping(address => uint256) public topUpFractionBps; // e.g. 3000 = only close 30% of the computed gap

    mapping(uint256 => uint256) public pmStaked; // marketId => vault's total staked (unresolved)
    mapping(uint256 => uint256) public comboStaked; // comboId => vault's total staked (unresolved)

    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);
    event ToppedUpMarket(uint256 indexed marketId, bool isYes, uint256 amount, uint256 targetThinPool, uint256 fullGap, address token);
    event ToppedUpCombo(uint256 indexed comboId, bool isYes, uint256 amount, uint256 targetThinPool, uint256 fullGap, address token);
    event MarketSettled(uint256 indexed marketId, uint256 staked, uint256 received);
    event ComboSettled(uint256 indexed comboId, uint256 staked, uint256 received);
    event Paused(bool paused);
    event RiskCapsUpdated(address indexed token, uint256 perMarketCap, uint256 globalCap, uint256 minDepthThreshold, uint256 floorBalance);
    event PricingParamsUpdated(address indexed token, uint256 targetMultiplierBps, uint256 referenceBetSize, uint256 topUpFractionBps);

    error VaultPaused();
    error ZeroAddress();
    error NotConfigured();
    error PoolNotThin();
    error AlreadyAtTarget();
    error CapsExhausted();
    error PerMarketCapExceeded();
    error GlobalCapExceeded();
    error CircuitBreakerFloor();
    error NothingStaked();
    error MarketNotResolved();
    error InvalidMultiplier();

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

    /// @notice Formulaically top up a thin PredictionMarket market. Anyone can call -
    ///         the amount and side are computed on-chain, not caller-supplied.
    function topUpMarket(uint256 marketId) external nonReentrant whenNotPaused {
        IPredictionMarketBet.Market memory m = predictionMarket.getMarket(marketId);
        uint256 feeBps = predictionMarket.feeBps();
        (bool isYes, uint256 amount, uint256 targetThinPool, uint256 fullGap) =
            _computeTopUp(m.collateralToken, m.yesPool, m.noPool, pmStaked[marketId], feeBps);

        if (m.collateralToken == ETH_SENTINEL) {
            predictionMarket.betETH{value: amount}(marketId, isYes);
        } else {
            IERC20(m.collateralToken).forceApprove(address(predictionMarket), amount);
            predictionMarket.bet(marketId, isYes, amount);
        }

        pmStaked[marketId] += amount;
        totalDeployed[m.collateralToken] += amount;
        emit ToppedUpMarket(marketId, isYes, amount, targetThinPool, fullGap, m.collateralToken);
    }

    /// @notice Formulaically top up a thin ComboMarket parlay. Anyone can call - the
    ///         amount and side are computed on-chain, not caller-supplied.
    function topUpCombo(uint256 comboId) external nonReentrant whenNotPaused {
        (, , address collateralToken, , uint256 yesPool, uint256 noPool, , ) = comboMarket.getCombo(comboId);
        uint256 feeBps = comboMarket.feeBps();
        (bool isYes, uint256 amount, uint256 targetThinPool, uint256 fullGap) =
            _computeTopUp(collateralToken, yesPool, noPool, comboStaked[comboId], feeBps);

        if (collateralToken == ETH_SENTINEL) {
            comboMarket.betComboETH{value: amount}(comboId, isYes);
        } else {
            IERC20(collateralToken).forceApprove(address(comboMarket), amount);
            comboMarket.betCombo(comboId, isYes, amount);
        }

        comboStaked[comboId] += amount;
        totalDeployed[collateralToken] += amount;
        emit ToppedUpCombo(comboId, isYes, amount, targetThinPool, fullGap, collateralToken);
    }

    /// @dev Core sizing formula. Computes how much the thin side needs to give a
    ///      referenceBetSize bet on the HEAVY side a payout of targetMultiplierBps:
    ///        targetThinPool = (heavyPool + referenceBetSize) * (targetMultiplierBps - netBps) / netBps
    ///      where netBps = 10000 - feeBps (the fraction of the pool actually paid out).
    ///      The vault only ever contributes topUpFractionBps of the resulting gap.
    function _computeTopUp(
        address token,
        uint256 yesPool,
        uint256 noPool,
        uint256 alreadyStaked,
        uint256 feeBps
    ) internal view returns (bool isYes, uint256 amount, uint256 targetThinPool, uint256 fullGap) {
        if (targetMultiplierBps[token] == 0 || referenceBetSize[token] == 0 || topUpFractionBps[token] == 0) {
            revert NotConfigured();
        }

        uint256 total = yesPool + noPool;
        if (total >= minDepthThreshold[token]) revert PoolNotThin();

        isYes = yesPool <= noPool; // thin side
        uint256 thinPool = isYes ? yesPool : noPool;
        uint256 heavyPool = isYes ? noPool : yesPool;

        uint256 netBps = BPS_DENOMINATOR - feeBps;
        if (targetMultiplierBps[token] <= netBps) revert InvalidMultiplier();
        uint256 numeratorBps = targetMultiplierBps[token] - netBps;

        targetThinPool = ((heavyPool + referenceBetSize[token]) * numeratorBps) / netBps;
        fullGap = targetThinPool > thinPool ? targetThinPool - thinPool : 0;
        if (fullGap == 0) revert AlreadyAtTarget();

        uint256 rawTopUp = (fullGap * topUpFractionBps[token]) / BPS_DENOMINATOR;

        uint256 remainingPerMarket = perMarketCap[token] > alreadyStaked ? perMarketCap[token] - alreadyStaked : 0;
        uint256 remainingGlobal = globalCap[token] > totalDeployed[token] ? globalCap[token] - totalDeployed[token] : 0;
        uint256 available = token == ETH_SENTINEL ? address(this).balance : IERC20(token).balanceOf(address(this));
        uint256 remainingFloor = available > floorBalance[token] ? available - floorBalance[token] : 0;

        amount = _min(rawTopUp, _min(remainingPerMarket, _min(remainingGlobal, remainingFloor)));
        if (amount == 0) revert CapsExhausted();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
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

    function setRiskCaps(
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
        emit RiskCapsUpdated(token, perMarketCap_, globalCap_, minDepthThreshold_, floorBalance_);
    }

    /// @param targetMultiplierBps_ e.g. 13000 for a 1.30x target on the heavy side. Must be > 10000.
    /// @param referenceBetSize_    "typical" bet size the target is computed for, e.g. 1e18 for 1 TSLA.
    /// @param topUpFractionBps_    fraction of the computed gap the vault actually contributes, e.g. 3000 = 30%. Max 10000.
    function setPricingParams(
        address token,
        uint256 targetMultiplierBps_,
        uint256 referenceBetSize_,
        uint256 topUpFractionBps_
    ) external onlyOwner {
        if (targetMultiplierBps_ <= BPS_DENOMINATOR) revert InvalidMultiplier();
        require(topUpFractionBps_ <= BPS_DENOMINATOR, "fraction > 100%");
        targetMultiplierBps[token] = targetMultiplierBps_;
        referenceBetSize[token] = referenceBetSize_;
        topUpFractionBps[token] = topUpFractionBps_;
        emit PricingParamsUpdated(token, targetMultiplierBps_, referenceBetSize_, topUpFractionBps_);
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
