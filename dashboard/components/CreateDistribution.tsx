"use client";

import { useState } from "react";
import { parseEther } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { distributionRouterAbi, erc20Abi } from "@rwaforge/sdk";
import { contractAddresses } from "@/lib/wagmi";

interface Row {
  recipient: string;
  amount: string;
}

export function CreateDistribution() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [tokenAddress, setTokenAddress] = useState("");
  const [rows, setRows] = useState<Row[]>([{ recipient: "", amount: "" }]);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const updateRow = (i: number, field: keyof Row, value: string) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, { recipient: "", amount: "" }]);
  const removeRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async () => {
    if (!isConnected || !address || !publicClient) return;
    if (!contractAddresses.distributionRouter) {
      setStatus("DistributionRouter address is not configured (see dashboard/.env.example).");
      return;
    }

    try {
      setSubmitting(true);
      setStatus("Reading protocol fee...");

      const recipients = rows.map((r) => r.recipient as `0x${string}`);
      const amounts = rows.map((r) => parseEther(r.amount || "0"));
      const total = amounts.reduce((a, b) => a + b, 0n);

      const feeBps = await publicClient.readContract({
        address: contractAddresses.distributionRouter,
        abi: distributionRouterAbi,
        functionName: "feeBps",
      });
      const fee = (total * feeBps) / 10_000n;
      const requiredApproval = total + fee;

      setStatus(`Approving ${tokenAddress} for ${requiredApproval.toString()} (incl. ${feeBps.toString() as any} bps fee)...`);
      const approveHash = await writeContractAsync({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "approve",
        args: [contractAddresses.distributionRouter, requiredApproval],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setStatus("Submitting distribution...");
      const distributeHash = await writeContractAsync({
        address: contractAddresses.distributionRouter,
        abi: distributionRouterAbi,
        functionName: "distribute",
        args: [tokenAddress as `0x${string}`, recipients, amounts],
      });
      await publicClient.waitForTransactionReceipt({ hash: distributeHash });

      setStatus(`Distribution confirmed: ${distributeHash}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Distribution failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <h2 className="text-base font-semibold text-slate-100">Create Distribution</h2>
      <p className="mt-1 text-sm text-slate-400">
        Batch-send an RWA/stock token to multiple recipients through DistributionRouter.
      </p>

      <label className="mt-4 block text-sm text-slate-300">Token address</label>
      <input
        value={tokenAddress}
        onChange={(e) => setTokenAddress(e.target.value)}
        placeholder="0x..."
        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
      />

      <div className="mt-4 space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={row.recipient}
              onChange={(e) => updateRow(i, "recipient", e.target.value)}
              placeholder="Recipient address"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
            />
            <input
              value={row.amount}
              onChange={(e) => updateRow(i, "amount", e.target.value)}
              placeholder="Amount"
              className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
            />
            <button
              onClick={() => removeRow(i)}
              disabled={rows.length === 1}
              className="rounded-lg border border-slate-700 px-3 text-sm text-slate-400 hover:border-red-400 hover:text-red-400 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button onClick={addRow} className="mt-3 text-sm text-mint hover:underline">
        + Add recipient
      </button>

      <button
        onClick={handleSubmit}
        disabled={!isConnected || submitting}
        className="mt-6 w-full rounded-lg bg-mint px-4 py-2 text-sm font-medium text-navy hover:bg-mint-bright transition-colors disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Distribute"}
      </button>

      {status && <p className="mt-3 break-all text-xs text-slate-400">{status}</p>}
    </div>
  );
}
