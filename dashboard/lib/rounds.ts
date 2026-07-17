export interface RoundEntry {
  index: string;
  account: `0x${string}`;
  amount: string;
  proof: `0x${string}`[];
}

export interface RoundData {
  root: `0x${string}`;
  rewardClaimer: `0x${string}`;
  forgeToken: `0x${string}`;
  entries: RoundEntry[];
}

export interface RoundManifestEntry {
  id: number;
  network: number;
  label: string;
  file: string;
}

/**
 * Merkle round data (root/entries/proofs) is generated offchain when a
 * distribution round is published — see contracts/scripts and
 * sdk/src/merkle.ts. Bundling it as static JSON under public/rounds/ lets the
 * dashboard auto-detect what a connected wallet can claim without needing a
 * backend indexer yet. For production use at scale, replace this with an API
 * that serves proofs per address instead of shipping the full entry list.
 */
export async function fetchRoundsManifest(): Promise<RoundManifestEntry[]> {
  const res = await fetch("/rounds/manifest.json");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchRound(file: string): Promise<RoundData> {
  const res = await fetch(`/rounds/${file}`);
  if (!res.ok) throw new Error(`Failed to load round data: ${file}`);
  return res.json();
}

export interface ClaimableEntry {
  roundId: number;
  roundLabel: string;
  rewardClaimer: `0x${string}`;
  index: bigint;
  amount: bigint;
  proof: `0x${string}`[];
}

/** Finds every round entry belonging to `address` on the given chain. */
export async function findEntriesForAddress(
  address: `0x${string}`,
  chainId: number
): Promise<ClaimableEntry[]> {
  const manifest = await fetchRoundsManifest();
  const results: ClaimableEntry[] = [];

  for (const round of manifest.filter((r) => r.network === chainId)) {
    const data = await fetchRound(round.file);
    for (const entry of data.entries) {
      if (entry.account.toLowerCase() === address.toLowerCase()) {
        results.push({
          roundId: round.id,
          roundLabel: round.label,
          rewardClaimer: data.rewardClaimer,
          index: BigInt(entry.index),
          amount: BigInt(entry.amount),
          proof: entry.proof,
        });
      }
    }
  }

  return results;
}
