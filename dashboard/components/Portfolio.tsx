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
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <p className="text-sm text-slate-400">Your $FORGE balance</p>
        <p className="mt-1 text-3xl font-bold text-slate-100">
          {forgeBalance === null ? "—" : Number(formatEther(forgeBalance)).toLocaleString()} <span className="text-mint">FORGE</span>
        </p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Claimable rewards</h2>
          <button onClick={refresh} disabled={loading} className="text-xs text-slate-400 hover:text-mint disabled:opacity-50">
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Rewards a protocol or agent has distributed to you, detected automatically — no manual index/proof entry needed.
        </p>

        {claimable.length === 0 && !loading && (
          <p className="mt-4 text-sm text-slate-500">Nothing to claim right now. Check back after a distribution round.</p>
        )}

        <div className="mt-4 space-y-3">
          {claimable.map((entry) => (
            <div
              key={`${entry.roundId}-${entry.index}`}
              className="flex items-center justify-between rounded-lg border border-mint/30 bg-mint/5 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-100">{Number(formatEther(entry.amount)).toLocaleString()} FORGE</p>
                <p className="text-xs text-slate-400">{entry.roundLabel}</p>
              </div>
              <button
                onClick={() => handleClaim(entry)}
                disabled={claimingIndex === entry.index}
                className="rounded-lg bg-mint px-4 py-2 text-sm font-medium text-navy hover:bg-mint/90 transition-colors disabled:opacity-50"
              >
                {claimingIndex === entry.index ? "Claiming..." : "Claim"}
              </button>
            </div>
          ))}
        </div>

        {status && <p className="mt-4 break-all text-xs text-slate-400">{status}</p>}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h2 className="text-lg font-semibold text-slate-100">Claim history</h2>
        {history.length === 0 && claimed.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No claims yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {history.map((h) => (
              <li key={h.txHash} className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{Number(formatEther(h.amount)).toLocaleString()} FORGE</span>
                <span className="text-xs text-slate-500">{h.txHash.slice(0, 10)}...{h.txHash.slice(-8)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
