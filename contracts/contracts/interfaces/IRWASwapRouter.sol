// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRWASwapRouter
/// @notice Minimal interface Treasury relies on to convert fee-token balances
///         into supported RWAs (e.g. Robinhood Chain stock tokens).
/// @dev Deliberately generic so any DEX/aggregator adapter (Uniswap-style router,
///      1inch-style aggregator, an RFQ system, etc.) can implement it and be
///      plugged into Treasury without changing Treasury itself. Integrators
///      provide their own implementation of this interface.
interface IRWASwapRouter {
    /// @notice Swap an exact amount of `tokenIn` for at least `minAmountOut` of `tokenOut`.
    /// @param tokenIn Token being sold (typically an accumulated protocol-fee token).
    /// @param tokenOut Target RWA token to acquire.
    /// @param amountIn Exact amount of `tokenIn` to sell.
    /// @param minAmountOut Minimum acceptable amount of `tokenOut` (slippage bound).
    /// @param recipient Address to receive `tokenOut` (normally the calling Treasury).
    /// @return amountOut Actual amount of `tokenOut` received.
    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut);
}
