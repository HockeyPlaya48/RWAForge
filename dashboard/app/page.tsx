import { ConnectWallet } from "@/components/ConnectWallet";
import { DashboardTabs } from "@/components/DashboardTabs";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mint text-lg font-bold text-navy">
            F
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              RWA<span className="text-mint">Forge</span>
            </h1>
            <p className="text-xs text-slate-500">Forge Real Value Onchain</p>
          </div>
        </div>
        <ConnectWallet />
      </header>

      <div className="mt-6 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
        </span>
        <span className="text-xs font-medium text-slate-400">Live on Robinhood Chain Testnet</span>
      </div>

      <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400">
        Distribute and claim tokenized RWAs and stock rewards, agent-native from the ground up.{" "}
        <span className="text-slate-200">Holders and agents</span> check their rewards below;{" "}
        <span className="text-slate-200">protocols sending payouts</span> use Operator Tools.
      </p>

      <DashboardTabs />

      <footer className="mt-16 border-t border-slate-800/60 pt-6 text-center text-xs text-slate-600">
        Example dashboard for RWAForge — configure contract addresses in{" "}
        <code className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-400">dashboard/.env.local</code>. MIT licensed.
      </footer>
    </main>
  );
}
