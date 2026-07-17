"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { rewardClaimerAbi } from "@rwaforge/sdk";
import { contractAddresses } from "@/lib/wagmi";

export function ClaimRewards() {
  const { isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [index, setIndex] = useState("");
  const [amount, setAmount] = useState("");
  const [proof, setProof] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleClaim = async () => {
    if (!isConnected || !publicClient) return;
    if (!contractAddresses.rewardClaimer) {
      setStatus("RewardClaimer address is not configured (see dashboard/.env.example).");
      return;
    }

    try {
      setSubmitting(true);
      setStatus("Submitting claim...");

      const proofArray = proof
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean) as `0x${string}`[];

      const hash = await writeContractAsync({
        address: contractAddresses.rewardClaimer,
        abi: rewardClaimerAbi,
        functionName: "claim",
        args: [BigInt(index || "0"), parseEther(amount || "0"), proofArray],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      setStatus(`Claim confirmed: ${hash}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <details className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <summary className="cursor-pointer text-base font-semibold text-slate-100">
        Advanced: manual claim
      </summary>
      <p className="mt-1 text-sm text-slate-400">
        For claiming a reward not yet in the bundled round data (see "My Rewards" for the automatic version) — enter your
        allocation's index, amount, and proof directly against RewardClaimer.
      </p>

      <label className="mt-4 block text-sm text-slate-300">Index</label>
      <input
        value={index}
        onChange={(e) => setIndex(e.target.value)}
        placeholder="42"
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
      />

      <label className="mt-4 block text-sm text-slate-300">Amount</label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="5.0"
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
      />

      <label className="mt-4 block text-sm text-slate-300">Merkle proof (comma-separated bytes32)</label>
      <textarea
        value={proof}
        onChange={(e) => setProof(e.target.value)}
        placeholder="0xabc..., 0xdef..."
        rows={3}
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
      />

      <button
        onClick={handleClaim}
        disabled={!isConnected || submitting}
        className="mt-6 w-full rounded-lg border border-mint px-4 py-2 text-sm font-medium text-mint hover:bg-mint-bright hover:text-navy transition-colors disabled:opacity-50"
      >
        {submitting ? "Claiming..." : "Claim"}
      </button>

      {status && <p className="mt-3 break-all text-xs text-slate-400">{status}</p>}
    </details>
  );
}
