// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TeamVesting
/// @notice Holds the team's $FORGE allocation (15% of supply) and releases it
///         linearly over 3 years with a 1-year cliff, per the RWAForge tokenomics.
/// @dev A single-beneficiary vesting escrow, scoped to one token. Deploy one
///      instance per beneficiary if the team allocation is split across people.
///      Kept intentionally simple/auditable rather than pulling in a generic
///      multi-schedule vesting framework.
contract TeamVesting is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Token being vested ($FORGE).
    IERC20 public immutable token;

    /// @notice Address that will receive vested tokens.
    address public immutable beneficiary;

    /// @notice Unix timestamp the vesting schedule starts counting from.
    uint64 public immutable startTimestamp;

    /// @notice Cliff duration in seconds (1 year). No tokens release before this elapses.
    uint64 public immutable cliffDuration;

    /// @notice Total vesting duration in seconds (3 years), measured from startTimestamp.
    uint64 public immutable vestingDuration;

    /// @notice Total amount ever released to the beneficiary.
    uint256 public released;

    /// @notice Emitted whenever vested tokens are released to the beneficiary.
    event TokensReleased(address indexed beneficiary, uint256 amount);

    /// @dev Thrown when `release()` is called but nothing is currently releasable.
    error NothingToRelease();
    /// @dev Thrown when `token_` or `beneficiary_` is the zero address at construction.
    error ZeroAddress();

    /// @param token_ The $FORGE token contract.
    /// @param beneficiary_ Address entitled to the vested tokens.
    /// @param owner_ Admin address (e.g. governance multisig) with no claim on funds,
    ///        only administrative rights over this contract itself (currently none
    ///        beyond Ownable's transfer-ownership bookkeeping).
    /// @param startTimestamp_ When vesting begins accruing (typically TGE).
    /// @param cliffDuration_ Seconds before which nothing is releasable (1 year = 365 days).
    /// @param vestingDuration_ Total seconds over which the full amount vests (3 years).
    constructor(
        IERC20 token_,
        address beneficiary_,
        address owner_,
        uint64 startTimestamp_,
        uint64 cliffDuration_,
        uint64 vestingDuration_
    ) Ownable(owner_) {
        if (beneficiary_ == address(0) || address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        beneficiary = beneficiary_;
        startTimestamp = startTimestamp_;
        cliffDuration = cliffDuration_;
        vestingDuration = vestingDuration_;
    }

    /// @notice Amount of tokens vested (releasable + already released) at the current time.
    /// @return The cumulative amount vested so far.
    function vestedAmount() public view returns (uint256) {
        return _vestedAmount(uint64(block.timestamp));
    }

    /// @notice Amount currently claimable by the beneficiary.
    /// @return The amount that `release()` would transfer if called now.
    function releasable() public view returns (uint256) {
        return vestedAmount() - released;
    }

    /// @notice Release all currently vested-but-unreleased tokens to the beneficiary.
    /// @dev Callable by anyone (agents/relayers included) — funds only ever move to
    ///      `beneficiary`, so permissionless triggering is safe and lets automation
    ///      release on a schedule without needing beneficiary key access.
    function release() external {
        uint256 amount = releasable();
        if (amount == 0) revert NothingToRelease();

        released += amount;
        emit TokensReleased(beneficiary, amount);

        token.safeTransfer(beneficiary, amount);
    }

    /// @dev Linear vesting from `startTimestamp`, zero before the cliff, full amount at/after `vestingEnd`.
    /// @param timestamp Point in time to evaluate the schedule at.
    /// @return The cumulative amount vested as of `timestamp`.
    function _vestedAmount(uint64 timestamp) internal view returns (uint256) {
        uint256 totalAllocation = released + token.balanceOf(address(this));
        uint64 cliffEnd = startTimestamp + cliffDuration;

        if (timestamp < cliffEnd) {
            return 0;
        }
        uint64 vestingEnd = startTimestamp + vestingDuration;
        if (timestamp >= vestingEnd) {
            return totalAllocation;
        }
        return (totalAllocation * (timestamp - startTimestamp)) / vestingDuration;
    }
}
