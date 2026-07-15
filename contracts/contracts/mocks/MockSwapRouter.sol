// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRWASwapRouter} from "../interfaces/IRWASwapRouter.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Test-only IRWASwapRouter implementation: "swaps" by pulling tokenIn
///         from the caller and minting tokenOut 1:1 to the recipient. Lets the
///         test suite exercise Treasury.executeSwap without a real DEX.
contract MockSwapRouter is IRWASwapRouter {
    using SafeERC20 for IERC20;

    function swapExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external override returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        amountOut = amountIn;
        require(amountOut >= minAmountOut, "slippage");
        MockERC20(tokenOut).mint(recipient, amountOut);
    }
}
