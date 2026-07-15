// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ForgeToken ($FORGE)
/// @notice Governance and revenue-share token for the RWAForge protocol.
/// @dev Total supply is hard-capped at 1,000,000,000 $FORGE. The owner may mint
///      up to that cap (e.g. to seed the initial allocation buckets documented in
///      the README: team vesting, community/airdrops, liquidity/ecosystem, treasury),
///      but can never exceed it — the cap makes "mintable by owner" and "fixed total
///      supply" compatible: minting only refills what has not yet been issued.
///      Supports EIP-2612 `permit` for gasless approvals, which matters for
///      agent-driven flows that want to batch approve+distribute in one UserOperation.
contract ForgeToken is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, Ownable {
    /// @notice Hard cap on total supply. Matches the documented tokenomics: 1B $FORGE.
    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether;

    /// @dev Thrown when a mint would push total supply above MAX_SUPPLY.
    error MaxSupplyExceeded(uint256 requested, uint256 available);

    /// @param initialOwner Address granted ownership (mint/pause rights) at deploy.
    constructor(address initialOwner)
        ERC20("RWAForge", "FORGE")
        ERC20Permit("RWAForge")
        Ownable(initialOwner)
    {}

    /// @notice Mint new $FORGE, bounded by MAX_SUPPLY.
    /// @dev Intended for owner-controlled initial distribution to allocation
    ///      buckets (e.g. TeamVesting, Treasury, a community distributor).
    ///      Once MAX_SUPPLY is fully minted this function becomes permanently inert.
    /// @param to Recipient of the newly minted tokens.
    /// @param amount Amount to mint, in 18 decimals.
    function mint(address to, uint256 amount) external onlyOwner {
        uint256 newSupply = totalSupply() + amount;
        if (newSupply > MAX_SUPPLY) {
            revert MaxSupplyExceeded(amount, MAX_SUPPLY - totalSupply());
        }
        _mint(to, amount);
    }

    /// @notice Pause all token transfers. Emergency use only.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume token transfers.
    function unpause() external onlyOwner {
        _unpause();
    }

    // --- Required overrides for multiple inheritance (OZ v5 uses _update) ---

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
