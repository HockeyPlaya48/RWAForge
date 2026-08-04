import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How RWAForge Works",
  description: "A plain-language guide to rewards, prediction markets, parlays, and the bankroll vault on RWAForge.",
};

function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-mint/10 text-xs font-bold text-mint">
        {n}
      </span>
      <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
    </div>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-mint/20 bg-mint/[0.04] px-4 py-3 text-sm leading-relaxed text-slate-300">
      {children}
    </div>
  );
}

// ── Diagrams (inline SVG, no external assets) ──────────────────────────────

function ClaimFlowDiagram() {
  return (
    <svg viewBox="0 0 700 140" className="w-full max-w-2xl mx-auto" role="img" aria-label="A protocol distributes tokenized stock rewards, which you claim into your wallet">
      {[
        { x: 10, label: "Protocol / AI agent", sub: "e.g. Sairi, Atelier" },
        { x: 260, label: "RWAForge", sub: "DistributionRouter" },
        { x: 510, label: "Your wallet", sub: "claim anytime" },
      ].map((box, i) => (
        <g key={i}>
          <rect x={box.x} y="35" width="180" height="70" rx="10" fill="#0F172A" stroke="#14B8A6" strokeOpacity="0.4" strokeWidth="1.5" />
          <text x={box.x + 90} y="65" textAnchor="middle" fill="#E2E8F0" fontSize="13" fontWeight="600">{box.label}</text>
          <text x={box.x + 90} y="83" textAnchor="middle" fill="#64748B" fontSize="10">{box.sub}</text>
        </g>
      ))}
      <path d="M195 70 L255 70" stroke="#14B8A6" strokeWidth="2" markerEnd="url(#arrow)" />
      <path d="M445 70 L505 70" stroke="#14B8A6" strokeWidth="2" markerEnd="url(#arrow)" />
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#14B8A6" />
        </marker>
      </defs>
    </svg>
  );
}

function PoolDiagram() {
  return (
    <svg viewBox="0 0 700 180" className="w-full max-w-2xl mx-auto" role="img" aria-label="Bettors on YES and NO share a single pool; winners split it proportionally">
      <text x="170" y="20" textAnchor="middle" fill="#4ADE80" fontSize="12" fontWeight="700">YES pool</text>
      <rect x="60" y="30" width="220" height="90" rx="8" fill="#4ADE80" fillOpacity="0.12" stroke="#4ADE80" strokeOpacity="0.4" />
      <text x="170" y="80" textAnchor="middle" fill="#4ADE80" fontSize="14" fontWeight="700">0.6 ETH staked</text>

      <text x="530" y="20" textAnchor="middle" fill="#F87171" fontSize="12" fontWeight="700">NO pool</text>
      <rect x="420" y="30" width="220" height="90" rx="8" fill="#F87171" fillOpacity="0.12" stroke="#F87171" strokeOpacity="0.4" />
      <text x="530" y="80" textAnchor="middle" fill="#F87171" fontSize="14" fontWeight="700">0.2 ETH staked</text>

      <path d="M340 75 L360 75" stroke="#64748B" strokeWidth="2" strokeDasharray="3 3" />
      <text x="350" y="105" textAnchor="middle" fill="#64748B" fontSize="11">vs</text>

      <text x="350" y="155" textAnchor="middle" fill="#94A3B8" fontSize="12">
        If YES wins: the 0.8 ETH total (minus a 2% fee) splits among YES bettors, by stake size
      </text>
    </svg>
  );
}

function ParlayChainDiagram() {
  const legs = [
    { label: "Leg 1", ok: true },
    { label: "Leg 2", ok: true },
    { label: "Leg 3", ok: false },
    { label: "Leg 4", ok: true },
  ];
  return (
    <svg viewBox="0 0 700 130" className="w-full max-w-2xl mx-auto" role="img" aria-label="All legs of a parlay must hit for the parlay to pay out">
      {legs.map((leg, i) => (
        <g key={i}>
          <rect
            x={20 + i * 165} y="30" width="140" height="60" rx="8"
            fill={leg.ok ? "#4ADE80" : "#F87171"} fillOpacity="0.12"
            stroke={leg.ok ? "#4ADE80" : "#F87171"} strokeOpacity="0.5"
          />
          <text x={90 + i * 165} y="55" textAnchor="middle" fill={leg.ok ? "#4ADE80" : "#F87171"} fontSize="12" fontWeight="700">
            {leg.label}
          </text>
          <text x={90 + i * 165} y="73" textAnchor="middle" fill={leg.ok ? "#4ADE80" : "#F87171"} fontSize="11">
            {leg.ok ? "hit" : "missed"}
          </text>
          {i < legs.length - 1 && (
            <text x={165 + i * 165} y="65" textAnchor="middle" fill="#64748B" fontSize="11" fontWeight="600">AND</text>
          )}
        </g>
      ))}
      <text x="350" y="118" textAnchor="middle" fill="#94A3B8" fontSize="12">
        One miss breaks the whole parlay — this one loses, even with 3 of 4 right
      </text>
    </svg>
  );
}

function VaultDiagram() {
  return (
    <svg viewBox="0 0 700 170" className="w-full max-w-2xl mx-auto" role="img" aria-label="The bankroll vault adds a modest, capped amount to the thinner side of a pool">
      <text x="170" y="20" textAnchor="middle" fill="#94A3B8" fontSize="12">Before</text>
      <rect x="60" y="30" width="220" height="20" rx="4" fill="#4ADE80" fillOpacity="0.5" />
      <text x="65" y="65" fill="#4ADE80" fontSize="11">Heavy side: 1 TSLA</text>
      <rect x="60" y="80" width="22" height="14" rx="3" fill="#F87171" fillOpacity="0.5" />
      <text x="90" y="91" fill="#F87171" fontSize="11">Thin side: 0.1 TSLA</text>

      <path d="M320 75 L380 75" stroke="#14B8A6" strokeWidth="2" markerEnd="url(#arrow2)" />
      <text x="350" y="60" textAnchor="middle" fill="#14B8A6" fontSize="10" fontWeight="600">vault tops up</text>

      <text x="530" y="20" textAnchor="middle" fill="#94A3B8" fontSize="12">After (partial, capped)</text>
      <rect x="420" y="30" width="220" height="20" rx="4" fill="#4ADE80" fillOpacity="0.5" />
      <text x="425" y="65" fill="#4ADE80" fontSize="11">Heavy side: 1 TSLA</text>
      <rect x="420" y="80" width="58" height="14" rx="3" fill="#F87171" fillOpacity="0.5" />
      <text x="485" y="91" fill="#F87171" fontSize="11">Thin side: 0.27 TSLA</text>

      <defs>
        <marker id="arrow2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#14B8A6" />
        </marker>
      </defs>
      <text x="350" y="140" textAnchor="middle" fill="#94A3B8" fontSize="12">
        Better odds for a "heavy side" bettor — not maxed out, just nudged toward reasonable
      </text>
    </svg>
  );
}

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mint text-lg font-bold text-navy">F</div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              RWA<span className="text-mint">Forge</span>
            </h1>
            <p className="text-xs text-slate-500">Forge Real Value Onchain</p>
          </div>
        </Link>
        <Link href="/" className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-500">
          ← Back to app
        </Link>
      </header>

      <div className="mt-8">
        <span className="rounded-full border border-mint/30 bg-mint/10 px-2.5 py-1 text-xs font-medium text-mint">
          How it works
        </span>
        <h1 className="mt-3 text-2xl font-bold text-slate-100">RWAForge, explained simply</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
          No jargon. This page walks through what RWAForge actually does — claiming rewards, betting on
          prediction markets, building parlays, and how a small safety fund makes thin markets a bit fairer.
          Everything described here runs live on Robinhood Chain Testnet — you can try every part of it for free.
        </p>
      </div>

      {/* Section 1 */}
      <section className="mt-12 space-y-4">
        <SectionLabel n="1" title="Claiming rewards" />
        <p className="text-sm leading-relaxed text-slate-400">
          Apps and AI agents you already use (like Sairi, Atelier, or Bankr) can send tokenized stock rewards to
          your wallet through RWAForge, in bulk, to lots of users at once. You don't have to do anything to
          receive them — check <span className="text-slate-200">My Rewards</span> in the app any time to see
          what's claimable, and claim it with one click. It's just yours; nobody can claim it except you.
        </p>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <ClaimFlowDiagram />
        </div>
      </section>

      {/* Section 2 */}
      <section className="mt-12 space-y-4">
        <SectionLabel n="2" title="Prediction markets" />
        <p className="text-sm leading-relaxed text-slate-400">
          A prediction market is a simple yes-or-no question — "Will TSLA exceed $350?" People bet on YES or NO
          using ETH or a tokenized stock. All the YES money goes into one pool, all the NO money into another.
          Whichever side turns out to be right splits the <em>entire</em> pool (both sides combined), in
          proportion to how much each person staked — minus a small 2% protocol fee. Nobody sets the odds; the
          size of each pool <em>is</em> the odds.
        </p>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <PoolDiagram />
        </div>
        <Callout>
          This means the payout isn't fixed in advance — it depends on how much money ends up on each side by the
          time the market resolves. A lopsided market (almost everyone agrees) pays little to the popular side and
          a lot to the contrarian side. That's normal, and it's the same way real-world betting pools like horse
          racing tote boards work.
        </Callout>
      </section>

      {/* Section 3 */}
      <section className="mt-12 space-y-4">
        <SectionLabel n="3" title="Parlays (combining predictions)" />
        <p className="text-sm leading-relaxed text-slate-400">
          Instead of betting on one question, a parlay bundles two or more together — "Will AAPL beat $220{" "}
          <em>and</em> will the Mets win tonight?" All the legs you pick have to be correct for the parlay to
          pay out. If even one leg misses, the whole parlay loses, no matter how many others hit. In exchange,
          a winning parlay usually pays more than betting each leg separately — you're taking on more risk for a
          bigger potential reward.
        </p>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <ParlayChainDiagram />
        </div>
        <p className="text-sm leading-relaxed text-slate-400">
          Parlays work the exact same pari-mutuel way as single markets — everyone betting "all legs hit" shares
          one pool, everyone betting "at least one misses" shares another, and once every leg has a real result,
          anyone can trigger the parlay to settle itself automatically.
        </p>
      </section>

      {/* Section 4 */}
      <section className="mt-12 space-y-4">
        <SectionLabel n="4" title="The bankroll vault (a small safety net)" />
        <p className="text-sm leading-relaxed text-slate-400">
          Brand-new markets sometimes start with almost no money in them. When that happens, the popular side of
          a bet can pay out almost nothing extra — technically fair, but not worth the trouble. To soften that,
          a small reserve called the <span className="text-slate-200">bankroll vault</span> can add a modest amount
          of its own money to the thinner side of a market, using the same currency as that market (no
          conversions, no swaps). It's not trying to make anyone rich — just enough to turn "not worth it" into
          "a reasonable, modest payout."
        </p>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
          <VaultDiagram />
        </div>
        <p className="text-sm leading-relaxed text-slate-400">The vault is deliberately boring and bounded:</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { title: "It's just another bettor", body: "It never promises anyone a payout. If its bet loses, it loses exactly what it put in — nothing more." },
            { title: "Per-market limit", body: "There's a hard cap on how much it will ever stake in any single market." },
            { title: "Global limit", body: "There's a hard cap on how much it has staked across every open market at once." },
            { title: "A floor it won't cross", body: "It refuses to top up anything if doing so would drop its own reserve below a set minimum — a built-in circuit breaker." },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <p className="text-xs font-semibold text-mint">{item.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{item.body}</p>
            </div>
          ))}
        </div>
        <Callout>
          The vault only closes part of the gap needed for a modest payout (currently aiming for roughly a
          1.2×–1.4× return on a typical-size bet) — not the whole thing. That keeps its own risk small per market,
          funded gradually rather than all at once, so it can keep running sustainably as more markets launch.
        </Callout>
      </section>

      {/* Section 5 */}
      <section className="mt-12 space-y-4">
        <SectionLabel n="5" title="What this is (and isn't) today" />
        <p className="text-sm leading-relaxed text-slate-400">
          Everything on this page runs live on <span className="text-slate-200">Robinhood Chain Testnet</span> —
          free to try, no real money involved. Odds, pools, and every number shown in the app are read directly
          from the deployed contracts, not simulated. Where the app shows outside reference odds (from
          Polymarket), that's clearly labeled as a separate market for context only — your bet always settles
          against RWAForge's own pool.
        </p>
      </section>

      <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
        <p className="text-sm text-slate-300">Ready to try it yourself?</p>
        <Link href="/" className="rounded-lg bg-mint px-5 py-2.5 text-sm font-semibold text-navy">
          Open the app
        </Link>
      </div>

      <footer className="mt-16 border-t border-slate-800/60 pt-6 text-center text-xs text-slate-600">
        RWAForge · MIT licensed ·{" "}
        <a href="https://github.com/HockeyPlaya48/RWAForge" target="_blank" rel="noopener noreferrer" className="hover:text-slate-400">
          GitHub
        </a>{" "}
        · Built on Robinhood Chain
      </footer>
    </main>
  );
}
