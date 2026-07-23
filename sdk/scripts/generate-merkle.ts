#!/usr/bin/env ts-node
/**
 * generate-merkle.ts
 *
 * Reads a CSV of (account, amount) pairs and outputs a JSON file containing:
 *   - merkleRoot  — publish via RewardClaimer.updateMerkleRoot(root)
 *   - entries[]   — per-user index, amount, and proof to supply when calling claim/claimFor
 *
 * Usage:
 *   npx ts-node sdk/scripts/generate-merkle.ts <input.csv> [output.json]
 *
 * CSV format (header row required):
 *   account,amount
 *   0xAbc...,1000000000000000000
 *   0xDef...,500000000000000000
 *
 * Amounts must be in the token's native units (wei for 18-decimal tokens).
 * The script generates deterministic indices (0, 1, 2, …) in CSV order.
 *
 * The tree uses double-hashed leaves and sorted pair-hashing at each level,
 * matching OpenZeppelin's MerkleProof.verify (v5) exactly.
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { keccak256, encodeAbiParameters, type Address } from "viem";

// ---------------------------------------------------------------------------
// Leaf hashing — must match RewardClaimer.sol:
//   keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
// ---------------------------------------------------------------------------

function computeLeaf(index: bigint, account: Address, amount: bigint): `0x${string}` {
  const encoded = encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }],
    [index, account, amount]
  );
  return keccak256(keccak256(encoded));
}

// ---------------------------------------------------------------------------
// Merkle tree — sorted-pair hashing, compatible with OZ MerkleProof.sol v5
// ---------------------------------------------------------------------------

function hashPair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return keccak256(`0x${lo.slice(2)}${hi.slice(2)}`);
}

function buildTree(leaves: `0x${string}`[]): `0x${string}`[][] {
  if (leaves.length === 0) throw new Error("No leaves provided");
  const layers: `0x${string}`[][] = [leaves.slice()];

  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: `0x${string}`[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      if (i + 1 < prev.length) {
        next.push(hashPair(prev[i], prev[i + 1]));
      } else {
        next.push(prev[i]); // odd node promoted as-is
      }
    }
    layers.push(next);
  }

  return layers;
}

function getProof(layers: `0x${string}`[][], leafIndex: number): `0x${string}`[] {
  const proof: `0x${string}`[] = [];
  let idx = leafIndex;

  for (let l = 0; l < layers.length - 1; l++) {
    const layer = layers[l];
    const sibling = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (sibling < layer.length) {
      proof.push(layer[sibling]);
    }
    idx = Math.floor(idx / 2);
  }

  return proof;
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

interface CsvRow {
  account: Address;
  amount: bigint;
}

async function parseCsv(filePath: string): Promise<CsvRow[]> {
  const rows: CsvRow[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  let header = true;
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (header) {
      header = false;
      continue; // skip header row
    }

    const parts = trimmed.split(",").map((p) => p.trim());
    if (parts.length < 2) {
      console.warn(`Skipping malformed row: ${trimmed}`);
      continue;
    }

    const account = parts[0] as Address;
    const amount = BigInt(parts[1]);

    if (!/^0x[0-9a-fA-F]{40}$/.test(account)) {
      console.warn(`Skipping invalid address: ${account}`);
      continue;
    }
    if (amount <= 0n) {
      console.warn(`Skipping zero-amount row for ${account}`);
      continue;
    }

    rows.push({ account, amount });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [, , inputArg, outputArg] = process.argv;

  if (!inputArg) {
    console.error("Usage: npx ts-node sdk/scripts/generate-merkle.ts <input.csv> [output.json]");
    process.exit(1);
  }

  const inputPath = path.resolve(inputArg);
  const outputPath = outputArg
    ? path.resolve(outputArg)
    : inputPath.replace(/\.csv$/i, "-merkle.json");

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const rows = await parseCsv(inputPath);
  if (rows.length === 0) {
    console.error("No valid rows found in CSV");
    process.exit(1);
  }

  console.log(`Building Merkle tree for ${rows.length} entries...`);

  const leaves = rows.map((row, i) =>
    computeLeaf(BigInt(i), row.account, row.amount)
  );

  const layers = buildTree(leaves);
  const merkleRoot = layers[layers.length - 1][0];

  const entries = rows.map((row, i) => ({
    index: i,
    account: row.account,
    amount: row.amount.toString(),
    proof: getProof(layers, i),
  }));

  const output = {
    merkleRoot,
    totalEntries: rows.length,
    totalAmount: rows.reduce((acc, r) => acc + r.amount, 0n).toString(),
    generatedAt: new Date().toISOString(),
    entries,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`Merkle root:   ${merkleRoot}`);
  console.log(`Total entries: ${rows.length}`);
  console.log(`Output:        ${outputPath}`);
  console.log(`\nNext: fund RewardClaimer with the token, then call:`);
  console.log(`  RewardClaimer.updateMerkleRoot("${merkleRoot}")`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
