// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library DistributionRouterSecurityExtensions {
    error MaxBatchSizeExceeded(uint256 size, uint256 maxAllowed);
    error ZeroRecipients();

    uint256 public constant MAX_BATCH_SIZE = 100;

    function validateBatchSize(uint256 recipientCount) internal pure {
        if (recipientCount == 0) revert ZeroRecipients();
        if (recipientCount > MAX_BATCH_SIZE) {
            revert MaxBatchSizeExceeded(recipientCount, MAX_BATCH_SIZE);
        }
    }
}
