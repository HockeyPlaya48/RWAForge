"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { erc20Abi, rewardClaimerAbi } from "@rwaforge/sdk";
import { contractAddresses } from "@/lib/wagmi";
import { findEntriesForAddress, type ClaimableEntry } from "@/lib/rounds";

interface ClaimedEvent {
  epoch: bigint;
  index: bigint;
  amount: bigint;
  txHash: `0x${string}`;
}

export function Portfolio() {
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [forgeBalance, setForgeBalance] = useState<bigint | null>(null);
  const [claimable, setClaimable] = useState<ClaimableEntry[]>([]);
  const [claimed, setClaimed] = useState<ClaimableEntry[]>([]);
  const [history, setHistory] = useState<ClaimedEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [claimingIndex, setClaimingIndex] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address || !publicClient || !chainId) return;
    setLoading(true);
    setStatus(null);

    try {
      if (contractAddresses.forgeToken) {
        const balance = await publicClient.readContract({
          address: contractAddresses.forgeToken,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [address],
        });
        setForgeBalance(balance);
      }

      const entries = await findEntriesForAddress(address, chainId);
      const claimableList: ClaimableEntry[] = [];
      const claimedList: ClaimableEntry[] = [];

      for (const entry of entries) {
        const isClaimed = await publicClient.readContract({
          address: entry.rewardClaimer,
          abi: rewardClaimerAbi,
          functionName: "isClaimed",
          args: [entry.index],
        });
        (isClaimed ? claimedList : claimableList).push(entry);
      }
      setClaimable(claimableList);
      setClaimed(claimedList);

      if (contractAddresses.rewardClaimer) {
        const logs = await publicClient.getLogs({
          address: contractAddresses.rewardClaimer,
          event: rewardClaimerAbi.find((item) => item.type === "event" && item.name === "Claimed")!,
          args: { account: address },
          fromBlock: 0n,
          toBlock: "latest",
        });
        setHistory(
          logs.map((log: any) => ({
            epoch: log.args.epoch as bigint,
            index: log.args.index as bigint,
            amount: log.args.amount as bigint,
            txHash: log.transactionHash,
          }))
        );
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to load portfolio");
    } finally {
      setLoading(false);
    }
  }, [address, publicClient, chainId]);

  useEffect(() => {
    if (isConnected) refresh();
  }, [isConnected, refresh]);

  const handleClaim = async (entry: ClaimableEntry) => {
    if (!publicClient) return;
    try {
      setClaimingIndex(entry.index);
      setStatus(`Claiming round "${entry.roundLabel}"...`);
      const hash = await writeContractAsync({
        address: entry.rewardClaimer,
        abi: rewardClaimerAbi,
        functionName: "claim",
        args: [entry.index, entry.amount, entry.proof],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus(`Claimed! tx: ${hash}`);
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setClaimingIndex(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-center">
        <p className="text-sm text-slate-400">Connect your wallet to see your $FORGE balance and any rewards you can claim.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-mint/5 blur-2xl" aria-hidden="true" />
        <p className="text-sm text-slate-400">Your $FORGE balance</p>
        <p className="mt-2 text-4xl font-bold tracking-tight text-slate-100">
          {forgeBalance === null ? (
            <span className="inline-block h-9 w-40 animate-pulse rounded bg-slate-800 align-middle" />
          ) : (
            Number(formatEther(forgeBalance)).toLocaleString()
          )}{" "}
          <span className="text-2xl text-mint">FORGE</span>
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Claimable rewards</h2>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-mint disabled:opacity-50"
          >
            <svg
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-4.9M20 15a8 8 0 01-14 4.9" />
            </svg>
            {loading ? "Refreshing" : "Refresh"}
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Detected automatically from your connected wallet — no manual index or proof entry needed.
        </p>

        {claimable.length === 0 && !loading && (
          <div className="mt-4 rounded-lg border border-dashed border-slate-800 px-4 py-6 text-center">
            <p className="text-sm text-slate-500">Nothing to claim right now.</p>
            <p className="mt-1 text-xs text-slate-600">Check back after a distribution round.</p>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {claimable.map((entry) => (
            <div
              key={`${entry.roundId}-${entry.index}`}
              className="flex items-center justify-between rounded-xl border border-mint/25 bg-mint/[0.06] px-4 py-3.5"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-mint/15 text-mint">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6M16 6l-4-4-4 4M12 2v13" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-medium text-slate-100">
                    {Number(formatEther(entry.amount)).toLocaleString()} FORGE
                  </p>
                  <p className="text-xs text-slate-500">{entry.roundLabel}</p>
                </div>
              </div>
              <button
                onClick={() => handleClaim(entry)}
                disabled={claimingIndex === entry.index}
                className="rounded-lg bg-mint px-4 py-2 text-sm font-medium text-navy shadow-sm transition-colors hover:bg-mint-bright disabled:opacity-50"
              >
                {claimingIndex === entry.index ? "Claiming..." : "Claim"}
              </button>
            </div>
          ))}
        </div>

        {status && <p className="mt-4 break-all rounded-lg bg-slate-950/50 px-3 py-2 text-xs text-slate-400">{status}</p>}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-base font-semibold text-slate-100">Claim history</h2>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No claims yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-800/60">
            {history.map((h) => (
              <li key={h.txHash} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-slate-400">
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="text-sm font-medium text-slate-200">
                    {Number(formatEther(h.amount)).toLocaleString()} FORGE
                  </span>
                </div>
                <span className="font-mono text-xs text-slate-500">
                  {h.txHash.slice(0, 8)}...{h.txHash.slice(-6)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
