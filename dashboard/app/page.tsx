import { ConnectWallet } from "@/components/ConnectWallet";
import { CreateDistribution } from "@/components/CreateDistribution";
import { ClaimRewards } from "@/components/ClaimRewards";

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

      <div className="mt-10 space-y-6">
        <CreateDistribution />
        <ClaimRewards />
      </div>

      <footer className="mt-10 text-center text-xs text-slate-600">
        Example dashboard for RWAForge — configure contract addresses in{" "}
        <code>dashboard/.env.local</code>. MIT licensed.
      </footer>
    </main>
  );
}
