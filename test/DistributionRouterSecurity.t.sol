// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/DistributionRouterSecurityExtensions.sol";

contract DistributionRouterSecurityTest is Test {
    function testRejectExcessiveBatchSize() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                DistributionRouterSecurityExtensions.MaxBatchSizeExceeded.selector,
                150,
                100
            )
        );
        DistributionRouterSecurityExtensions.validateBatchSize(150);
    }

    function testAllowValidBatchSize() public pure {
        DistributionRouterSecurityExtensions.validateBatchSize(50);
    }
}
