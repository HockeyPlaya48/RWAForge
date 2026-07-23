"use client";

import { useState } from "react";
import { Portfolio } from "@/components/Portfolio";
import { CreateDistribution } from "@/components/CreateDistribution";
import { ClaimRewards } from "@/components/ClaimRewards";
import { PredictionMarkets } from "@/components/PredictionMarkets";

type Tab = "rewards" | "markets" | "operator";

const TAB_LABELS: Record<Tab, string> = {
  rewards: "My Rewards",
  markets: "Predict",
  operator: "Operator Tools",
};

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  rewards:
    "For holders and agents receiving distributions — check your balance, see what's claimable, and claim with one click.",
  markets:
    "Live prediction markets powered by Polymarket — trade on outcomes related to your RWA holdings.",
  operator:
    "For protocols, DAOs, or agents sending distributions — batch-send an RWA/stock token to a list of recipients.",
};

export function DashboardTabs() {
  const [tab, setTab] = useState<Tab>("rewards");

  return (
    <div className="mt-8">
      <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-900/40 p-1">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
              tab === t
                ? "bg-mint text-navy shadow-sm"
                : "text-slate-400 hover:text-slate-100"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <p className="mt-3 px-1 text-xs text-slate-500">{TAB_DESCRIPTIONS[tab]}</p>

      <div className="mt-6 space-y-6">
        {tab === "rewards" && <Portfolio />}
        {tab === "markets" && <PredictionMarkets />}
        {tab === "operator" && (
          <>
            <CreateDistribution />
            <ClaimRewards />
          </>
        )}
      </div>
    </div>
  );
}
