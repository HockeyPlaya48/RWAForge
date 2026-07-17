"use client";

import { useState } from "react";
import { Portfolio } from "@/components/Portfolio";
import { CreateDistribution } from "@/components/CreateDistribution";
import { ClaimRewards } from "@/components/ClaimRewards";

type Tab = "rewards" | "operator";

export function DashboardTabs() {
  const [tab, setTab] = useState<Tab>("rewards");

  return (
    <div className="mt-10">
      <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-900/50 p-1">
        <button
          onClick={() => setTab("rewards")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "rewards" ? "bg-mint text-navy" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          My Rewards
        </button>
        <button
          onClick={() => setTab("operator")}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            tab === "operator" ? "bg-mint text-navy" : "text-slate-400 hover:text-slate-100"
          }`}
        >
          Operator Tools
        </button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {tab === "rewards"
          ? "For holders and agents receiving distributions — check your balance, see what's claimable, and claim with one click."
          : "For protocols, DAOs, or agents sending distributions — batch-send an RWA/stock token to a list of recipients."}
      </p>

      <div className="mt-6 space-y-6">
        {tab === "rewards" ? (
          <Portfolio />
        ) : (
          <>
            <CreateDistribution />
            <ClaimRewards />
          </>
        )}
      </div>
    </div>
  );
}
