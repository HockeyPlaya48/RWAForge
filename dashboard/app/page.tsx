import { ConnectWallet } from "@/components/ConnectWallet";
import { DashboardTabs } from "@/components/DashboardTabs";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            RWA<span className="text-mint">Forge</span>
          </h1>
          <p className="text-sm text-slate-400">Forge Real Value Onchain.</p>
        </div>
        <ConnectWallet />
      </header>

      <p className="mt-6 max-w-xl text-sm text-slate-400">
        Distribute and claim tokenized RWAs and stock rewards on Robinhood Chain.
        Holders and agents check <span className="text-slate-200">My Rewards</span>; protocols sending
        payouts use <span className="text-slate-200">Operator Tools</span>.
      </p>

      <DashboardTabs />

      <footer className="mt-10 text-center text-xs text-slate-600">
        Example dashboard for RWAForge — configure contract addresses in{" "}
        <code>dashboard/.env.local</code>. MIT licensed.
      </footer>
    </main>
  );
}
