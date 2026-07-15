// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title RewardClaimer
/// @notice Merkle-root based claim contract for airdrops and revenue-share
///         distributions of a single reward token (deploy one instance per
///         reward token, e.g. one for $FORGE community airdrops and one per
///         RWA the Treasury distributes).
/// @dev Supports successive distribution rounds: governance publishes a new
///      Merkle root per "epoch" and funds the contract accordingly. Claim
///      status is tracked per (epoch, index), so a new root does not need to
///      avoid reusing indices from a previous round.
///
///      Agent-native by design: `claim` is self-service (caller must be the
///      recipient), while `claimFor` lets any relayer — including an
///      ERC-4337 agent paying its own gas — submit the claim on behalf of a
///      recipient. Funds always go to `account`, never to the caller, so
///      `claimFor` cannot be used to redirect anyone else's rewards.
contract RewardClaimer is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Token distributed by this claimer.
    IERC20 public immutable token;

    /// @notice Current Merkle root recipients prove membership against.
    bytes32 public merkleRoot;

    /// @notice Current distribution round. Incremented every time the root is updated.
    uint256 public epoch;

    /// @dev epoch => index => claimed.
    mapping(uint256 => mapping(uint256 => bool)) private _claimed;

    /// @notice Emitted when governance publishes a new Merkle root, starting a new epoch.
    event MerkleRootUpdated(uint256 indexed epoch, bytes32 merkleRoot);
    /// @notice Emitted when a reward is successfully claimed, self-service or relayed.
    event Claimed(uint256 indexed epoch, uint256 index, address indexed account, uint256 amount, address indexed relayer);
    /// @notice Emitted when governance sweeps leftover tokens out of this contract.
    event Swept(address indexed token, address indexed to, uint256 amount);

    /// @dev Thrown when `index` has already been claimed in the current epoch.
    error AlreadyClaimed(uint256 epoch, uint256 index);
    /// @dev Thrown when the supplied Merkle proof does not verify against `merkleRoot`.
    error InvalidProof();
    /// @dev Thrown when a zero address is passed where a real address is required.
    error ZeroAddress();

    /// @param token_ Token distributed by this claimer.
    /// @param initialOwner Address granted ownership (root-update/sweep rights) at deploy.
    constructor(IERC20 token_, address initialOwner) Ownable(initialOwner) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    /// @notice Whether `index` has been claimed in the current epoch.
    function isClaimed(uint256 index) public view returns (bool) {
        return _claimed[epoch][index];
    }

    /// @notice Publish a new Merkle root and start a new distribution round.
    /// @dev Must be funded (via a plain ERC-20 transfer to this contract, typically
    ///      from Treasury.withdraw) with enough `token` to cover the new root's total.
    /// @param newRoot Merkle root for the new distribution round.
    function updateMerkleRoot(bytes32 newRoot) external onlyOwner {
        epoch += 1;
        merkleRoot = newRoot;
        emit MerkleRootUpdated(epoch, newRoot);
    }

    /// @notice Self-service claim — caller must be the reward recipient.
    /// @param index Leaf index in the current epoch's Merkle tree.
    /// @param amount Amount to claim, as encoded in the leaf.
    /// @param proof Merkle proof for `(index, msg.sender, amount)` against `merkleRoot`.
    function claim(uint256 index, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        _claim(index, msg.sender, amount, proof, msg.sender);
    }

    /// @notice Relayed claim — anyone (typically an agent or sponsor paying gas)
    ///         may submit proof on behalf of `account`. Funds always go to `account`.
    /// @param index Leaf index in the current epoch's Merkle tree.
    /// @param account Reward recipient; receives the tokens regardless of who calls this.
    /// @param amount Amount to claim, as encoded in the leaf.
    /// @param proof Merkle proof for `(index, account, amount)` against `merkleRoot`.
    function claimFor(uint256 index, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        _claim(index, account, amount, proof, msg.sender);
    }

    /// @dev Shared verification + payout path for `claim` and `claimFor`.
    /// @param relayer The caller that submitted the transaction (may differ from `account`).
    function _claim(
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata proof,
        address relayer
    ) internal {
        if (account == address(0)) revert ZeroAddress();
        if (isClaimed(index)) revert AlreadyClaimed(epoch, index);

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert InvalidProof();

        _claimed[epoch][index] = true;
        emit Claimed(epoch, index, account, amount, relayer);

        token.safeTransfer(account, amount);
    }

    /// @notice Recover tokens left over after a round closes (e.g. unclaimed
    ///         allocation being rolled into the next epoch's funding).
    /// @param sweepToken Token to sweep (not necessarily the claimer's own `token`).
    /// @param to Recipient of the swept tokens.
    /// @param amount Amount to sweep.
    function sweep(address sweepToken, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        emit Swept(sweepToken, to, amount);
        IERC20(sweepToken).safeTransfer(to, amount);
    }
}
