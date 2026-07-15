import { encodeAbiParameters, keccak256, type Address } from "viem";

/**
 * Computes the double-hashed leaf used by RewardClaimer, matching the
 * contract's `keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))`.
 * Use this when building the Merkle tree offchain (e.g. with merkletreejs)
 * before publishing a root via `RewardClaimer.updateMerkleRoot`.
 */
export function claimLeaf(index: bigint, account: Address, amount: bigint): `0x${string}` {
  const encoded = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [index, account, amount]
  );
  const inner = keccak256(encoded);
  return keccak256(inner);
}
