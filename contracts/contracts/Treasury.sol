// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IRWASwapRouter} from "./interfaces/IRWASwapRouter.sol";

/// @title Treasury
/// @notice Collects protocol fees forwarded by DistributionRouter, swaps them
///         into governance-approved RWAs, and tracks resulting holdings so
///         they can be pushed out to RewardClaimer for pro-rata distribution.
/// @dev Role-based rather than single-owner so that an automated
///      keeper/agent (OPERATOR_ROLE) can execute pre-approved swaps without
///      holding withdrawal rights, which stay with GOVERNANCE_ROLE
///      (expected to be a multisig, later a DAO governor).
contract Treasury is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice RWA tokens governance has approved as valid swap destinations.
    mapping(address => bool) public isSupportedRWA;

    /// @notice Running tally of each RWA token acquired via swaps, for portfolio tracking.
    mapping(address => uint256) public rwaHoldings;

    /// @notice Emitted when a distributor logs a fee deposit via `notifyFeeReceived`.
    event FeeReceived(address indexed token, uint256 amount, address indexed from);
    /// @notice Emitted when governance adds or removes a token from the supported-RWA list.
    event RWASupportUpdated(address indexed token, bool supported);
    /// @notice Emitted after an operator executes a fee-token -> RWA swap.
    event RWASwapExecuted(
        address indexed router,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    /// @notice Emitted when governance withdraws tokens from the treasury.
    event Withdrawal(address indexed token, address indexed to, uint256 amount);

    /// @dev Thrown when `executeSwap` targets a `tokenOut` not on the supported-RWA list.
    error UnsupportedRWA(address token);
    /// @dev Thrown when a zero address is passed where a real address is required.
    error ZeroAddress();
    /// @dev Thrown when a zero amount is passed where a positive amount is required.
    error ZeroAmount();

    /// @param governance Address granted DEFAULT_ADMIN_ROLE and GOVERNANCE_ROLE at deploy.
    constructor(address governance) {
        if (governance == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, governance);
        _grantRole(GOVERNANCE_ROLE, governance);
    }

    /// @notice Protocol fees arrive here via plain ERC-20 transfers from
    ///         DistributionRouter. This helper lets a distributor emit an
    ///         indexable record of the deposit in the same transaction if desired;
    ///         it is optional bookkeeping, not required for funds to be usable.
    /// @param token Fee token that was deposited.
    /// @param amount Amount deposited.
    function notifyFeeReceived(address token, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        emit FeeReceived(token, amount, msg.sender);
    }

    /// @notice Add or remove a token from the supported-RWA swap-destination list.
    /// @param token RWA token to update.
    /// @param supported Whether `token` is a valid `executeSwap` destination.
    function setSupportedRWA(address token, bool supported) external onlyRole(GOVERNANCE_ROLE) {
        if (token == address(0)) revert ZeroAddress();
        isSupportedRWA[token] = supported;
        emit RWASupportUpdated(token, supported);
    }

    /// @notice Swap accumulated fee-token balance into a supported RWA.
    /// @dev Restricted to OPERATOR_ROLE so keepers/agents can execute
    ///      governance-approved swaps without holding withdrawal rights.
    ///      `minAmountOut` is the caller's responsibility (slippage protection).
    /// @param router Swap adapter implementing IRWASwapRouter.
    /// @param tokenIn Fee token being sold.
    /// @param tokenOut Supported RWA token being acquired.
    /// @param amountIn Exact amount of `tokenIn` to sell.
    /// @param minAmountOut Minimum acceptable amount of `tokenOut` (slippage bound).
    /// @return amountOut Actual amount of `tokenOut` received.
    function executeSwap(
        IRWASwapRouter router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) external onlyRole(OPERATOR_ROLE) nonReentrant returns (uint256 amountOut) {
        if (!isSupportedRWA[tokenOut]) revert UnsupportedRWA(tokenOut);
        if (amountIn == 0) revert ZeroAmount();

        IERC20(tokenIn).forceApprove(address(router), amountIn);
        amountOut = router.swapExactIn(tokenIn, tokenOut, amountIn, minAmountOut, address(this));
        IERC20(tokenIn).forceApprove(address(router), 0);

        rwaHoldings[tokenOut] += amountOut;
        emit RWASwapExecuted(address(router), tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Withdraw tokens from the treasury — e.g. to fund a new RewardClaimer
    ///         Merkle round, or for approved operational spend.
    /// @dev Updates rwaHoldings by at most the tracked amount, never going below
    ///      zero, so the accounting stays accurate even when the withdrawal exceeds
    ///      tracked holdings (e.g. untracked fee tokens).
    /// @param token Token to withdraw.
    /// @param to Recipient of the withdrawn tokens.
    /// @param amount Amount to withdraw.
    function withdraw(address token, address to, uint256 amount)
        external
        onlyRole(GOVERNANCE_ROLE)
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        // Reduce rwaHoldings by up to amount, but never below zero — the
        // contract may hold untracked fee tokens beyond what rwaHoldings
        // records, and that excess should not distort the RWA tracker.
        uint256 tracked = rwaHoldings[token];
        if (tracked > 0) {
            uint256 deduction = amount < tracked ? amount : tracked;
            rwaHoldings[token] = tracked - deduction;
        }

        emit Withdrawal(token, to, amount);
        IERC20(token).safeTransfer(to, amount);
    }
}
