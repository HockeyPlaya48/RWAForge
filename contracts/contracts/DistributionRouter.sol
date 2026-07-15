// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DistributionRouter
/// @notice Permissionless batch-distribution entry point for any ERC-20,
///         including Robinhood Chain stock tokens and other RWAs.
/// @dev Any caller — EOA, contract, or ERC-4337 smart account — can distribute
///      tokens they hold/have approved to a batch of recipients in one call.
///      A protocol fee (bounded 1-5%, default 3%) is charged on top of the
///      distributed amounts and routed to the Treasury. Recipients always
///      receive exactly the amount specified for them; the fee is an
///      additional cost borne by the distributor, not deducted pro-rata.
contract DistributionRouter is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Governance-enforced floor on the protocol fee: 1%.
    uint256 public constant MIN_FEE_BPS = 100;

    /// @notice Governance-enforced ceiling on the protocol fee: 5%.
    uint256 public constant MAX_FEE_BPS = 500;

    /// @notice Upper bound on recipients per call, to keep gas predictable.
    uint256 public constant MAX_BATCH_SIZE = 500;

    /// @notice Current protocol fee, in basis points. Starts conservative at 3%.
    uint256 public feeBps = 300;

    /// @notice Address that receives protocol fees.
    address public treasury;

    /// @notice Emitted after a batch distribution completes successfully.
    event DistributionExecuted(
        address indexed distributor,
        address indexed token,
        uint256 recipientCount,
        uint256 totalDistributed,
        uint256 feeCharged
    );
    /// @notice Emitted when governance changes the protocol fee.
    event FeeBpsUpdated(uint256 previousFeeBps, uint256 newFeeBps);
    /// @notice Emitted when governance changes the treasury address.
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);

    /// @dev Thrown when `recipients`/`amounts` are empty or mismatched in length.
    error InvalidBatch();
    /// @dev Thrown when a batch exceeds MAX_BATCH_SIZE.
    error BatchTooLarge();
    /// @dev Thrown when a recipient in the batch is the zero address.
    error ZeroRecipient();
    /// @dev Thrown when an amount in the batch is zero.
    error ZeroAmount();
    /// @dev Thrown when `setFeeBps` is called outside [MIN_FEE_BPS, MAX_FEE_BPS].
    error FeeOutOfBounds(uint256 requested, uint256 min, uint256 max);
    /// @dev Thrown when a zero address is passed where a real address is required.
    error ZeroAddress();

    /// @param initialOwner Address granted ownership (fee/treasury/pause rights) at deploy.
    /// @param treasury_ Address that receives protocol fees.
    constructor(address initialOwner, address treasury_) Ownable(initialOwner) {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
    }

    /// @notice Distribute `token` to `recipients` in the exact `amounts` given, charging
    ///         the current protocol fee on top and routing it to the treasury.
    /// @dev Caller must have approved this contract for at least
    ///      `sum(amounts) + fee` of `token`. Reverts entirely if any transfer fails,
    ///      so a distribution either fully succeeds or has no effect.
    /// @param token ERC-20 (or RWA/stock token) being distributed.
    /// @param recipients Recipient addresses. Must be non-empty and match `amounts` length.
    /// @param amounts Amount each corresponding recipient receives, in `token`'s native decimals.
    /// @return totalDistributed Sum of `amounts` actually sent to recipients.
    /// @return feeCharged Protocol fee sent to the treasury for this distribution.
    function distribute(IERC20 token, address[] calldata recipients, uint256[] calldata amounts)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 totalDistributed, uint256 feeCharged)
    {
        uint256 len = recipients.length;
        if (len == 0 || len != amounts.length) revert InvalidBatch();
        if (len > MAX_BATCH_SIZE) revert BatchTooLarge();

        uint256 total;
        for (uint256 i; i < len; ++i) {
            if (recipients[i] == address(0)) revert ZeroRecipient();
            if (amounts[i] == 0) revert ZeroAmount();
            total += amounts[i];
        }

        uint256 fee = (total * feeBps) / BPS_DENOMINATOR;

        if (fee > 0) {
            token.safeTransferFrom(msg.sender, treasury, fee);
        }
        for (uint256 i; i < len; ++i) {
            token.safeTransferFrom(msg.sender, recipients[i], amounts[i]);
        }

        emit DistributionExecuted(msg.sender, address(token), len, total, fee);
        return (total, fee);
    }

    /// @notice Update the protocol fee. Hard-bounded to [MIN_FEE_BPS, MAX_FEE_BPS]
    ///         regardless of who holds ownership (e.g. after transfer to a DAO governor).
    /// @param newFeeBps New fee, in basis points, must be within [MIN_FEE_BPS, MAX_FEE_BPS].
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps < MIN_FEE_BPS || newFeeBps > MAX_FEE_BPS) {
            revert FeeOutOfBounds(newFeeBps, MIN_FEE_BPS, MAX_FEE_BPS);
        }
        emit FeeBpsUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /// @notice Update the treasury address that receives protocol fees.
    /// @param newTreasury New treasury address; must not be the zero address.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    /// @notice Pause distributions in an emergency. Does not affect other contracts.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume distributions.
    function unpause() external onlyOwner {
        _unpause();
    }
}
