"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";

const RH_TESTNET_ID = 46630;
import { parseEther, parseUnits, formatEther } from "viem";
import { fetchFinanceMarkets, type PolymarketMarket } from "@/lib/polymarket";

// ── ABI ───────────────────────────────────────────────────────────────────────

const PREDICTION_MARKET_ABI = [
  {
    type: "function", name: "bet",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "isYes", type: "bool" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "betETH",
    inputs: [{ name: "marketId", type: "uint256" }, { name: "isYes", type: "bool" }],
    outputs: [], stateMutability: "payable",
  },
  {
    type: "function", name: "claimWinnings",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "yesBets",
    inputs: [{ name: "marketId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }], stateMutability: "view",
  },
  {
    type: "function", name: "noBets",
    inputs: [{ name: "marketId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }], stateMutability: "view",
  },
  {
    type: "function", name: "previewPayout",
    inputs: [{ name: "marketId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }], stateMutability: "view",
  },
  {
    type: "function", name: "claimed",
    inputs: [{ name: "marketId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ name: "", type: "bool" }], stateMutability: "view",
  },
  {
    type: "function", name: "getMarket",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{
      name: "", type: "tuple",
      components: [
        { name: "question", type: "string" },
        { name: "collateralToken", type: "address" },
        { name: "endTime", type: "uint256" },
        { name: "yesPool", type: "uint256" },
        { name: "noPool", type: "uint256" },
        { name: "outcome", type: "uint8" },
        { name: "creator", type: "address" },
      ],
    }], stateMutability: "view",
  },
] as const;

// ── Collateral options ────────────────────────────────────────────────────────

const COLLATERAL_OPTIONS = [
  { label: "ETH", value: "ETH", decimals: 18 },
  { label: "USGD", value: "USGD", decimals: 6 },
  { label: "AAPL", value: "AAPL", decimals: 6 },
  { label: "TSLA", value: "TSLA", decimals: 6 },
  { label: "NVDA", value: "NVDA", decimals: 6 },
];

// ── Native RWAForge markets ───────────────────────────────────────────────────

type NativeMarket = {
  id: number;
  question: string;
  description: string;
  category: string;
  endTime: number;
  yesPool: number;
  noPool: number;
  defaultCollateral: string;
  status: "open" | "closed";
};

const NATIVE_MARKETS: NativeMarket[] = [
  {
    id: 0,
    question: "Will tokenized AAPL on RH Chain exceed $220 by end of Q3 2026?",
    description: "Resolves YES if AAPL closes above $220 on September 30, 2026 per Robinhood's tokenized equity price feed.",
    category: "Stocks",
    endTime: new Date("2026-09-30").getTime(),
    yesPool: 1250,
    noPool: 800,
    defaultCollateral: "ETH",
    status: "open",
  },
  {
    id: 1,
    question: "Will the Federal Reserve cut rates in September 2026?",
    description: "Resolves YES if the FOMC announces a rate cut at the September 2026 meeting.",
    category: "Macro",
    endTime: new Date("2026-09-21").getTime(),
    yesPool: 3200,
    noPool: 900,
    defaultCollateral: "USGD",
    status: "open",
  },
  {
    id: 2,
    question: "Will tokenized TSLA exceed $350 before October 2026?",
    description: "Resolves YES if TSLA's tokenized price on RH Chain closes above $350 on any trading day before October 1, 2026.",
    category: "Stocks",
    endTime: new Date("2026-09-30").getTime(),
    yesPool: 870,
    noPool: 1540,
    defaultCollateral: "ETH",
    status: "open",
  },
  {
    id: 3,
    question: "Will RWAForge reach $1M total distribution volume by Oct 2026?",
    description: "Resolves YES if the cumulative USD value distributed via RWAForge DistributionRouter exceeds $1,000,000 before November 1, 2026.",
    category: "RWAForge",
    endTime: new Date("2026-10-01").getTime(),
    yesPool: 500,
    noPool: 1100,
    defaultCollateral: "USGD",
    status: "open",
  },
  {
    id: 4,
    question: "Will Bitcoin exceed $120,000 before October 2026?",
    description: "Resolves YES if BTC/USD on any major exchange closes above $120,000 before October 1, 2026.",
    category: "Crypto",
    endTime: new Date("2026-09-30").getTime(),
    yesPool: 4800,
    noPool: 2100,
    defaultCollateral: "ETH",
    status: "open",
  },
  {
    id: 5,
    question: "Will NVIDIA beat Q3 2026 earnings estimates?",
    description: "Resolves YES if NVIDIA reports Q3 2026 EPS above analyst consensus estimates at time of market creation.",
    category: "Stocks",
    endTime: new Date("2026-11-20").getTime(),
    yesPool: 2200,
    noPool: 650,
    defaultCollateral: "ETH",
    status: "open",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtVolume(v: number | string): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (isNaN(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function daysLeft(endTime: number): string {
  const d = Math.ceil((endTime - Date.now()) / 86_400_000);
  if (d < 0) return "Resolving";
  if (d === 0) return "Ends today";
  return `${d}d left`;
}

const CATEGORY_COLORS: Record<string, string> = {
  Stocks: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Macro: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  Crypto: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  RWAForge: "text-mint bg-mint/10 border-mint/20",
  Market: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

// ── Probability bar ───────────────────────────────────────────────────────────

function ProbBar({ yes, no }: { yes: number; no: number }) {
  const total = yes + no;
  const yesPct = total > 0 ? (yes / total) * 100 : 50;
  return (
    <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-400"
        style={{ width: `${yesPct.toFixed(1)}%` }}
      />
    </div>
  );
}

// ── Native market card with inline bet form ───────────────────────────────────

function NativeCard({
  market,
  expanded,
  onToggle,
}: {
  market: NativeMarket;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: RH_TESTNET_ID });

  const [side, setSide] = useState<"yes" | "no" | null>(null);
  const [amount, setAmount] = useState("");
  const [collateral, setCollateral] = useState(market.defaultCollateral);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const contractAddress = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS as `0x${string}` | undefined;
  const total = market.yesPool + market.noPool;
  const yesPct = total > 0 ? (market.yesPool / total) * 100 : 50;
  const noPct = 100 - yesPct;
  const catColor = CATEGORY_COLORS[market.category] ?? CATEGORY_COLORS.Market;

  const handleBet = async () => {
    if (!isConnected) { setTxStatus("Connect your wallet first."); return; }
    if (!side) { setTxStatus("Select YES or NO."); return; }
    if (!amount || parseFloat(amount) <= 0) { setTxStatus("Enter an amount."); return; }
    if (!contractAddress) {
      setTxStatus("PredictionMarket not deployed yet — set NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS.");
      return;
    }

    setSubmitting(true);
    setTxStatus("Submitting...");
    try {
      // Switch to RH Chain testnet if needed
      if (chainId !== RH_TESTNET_ID) {
        setTxStatus("Switching to RH Chain Testnet...");
        await switchChainAsync({ chainId: RH_TESTNET_ID });
      }

      const isYes = side === "yes";
      const selectedColl = COLLATERAL_OPTIONS.find((c) => c.value === collateral);
      let hash: `0x${string}`;

      if (collateral === "ETH") {
        hash = await writeContractAsync({
          address: contractAddress,
          abi: PREDICTION_MARKET_ABI,
          functionName: "betETH",
          args: [BigInt(market.id), isYes],
          value: parseEther(amount),
        });
      } else {
        hash = await writeContractAsync({
          address: contractAddress,
          abi: PREDICTION_MARKET_ABI,
          functionName: "bet",
          args: [BigInt(market.id), isYes, parseUnits(amount, selectedColl?.decimals ?? 6)],
        });
      }

      await publicClient?.waitForTransactionReceipt({ hash });
      setTxStatus(`Bet placed! ${hash.slice(0, 10)}…`);
      setSide(null);
      setAmount("");
    } catch (err) {
      setTxStatus(err instanceof Error ? err.message.slice(0, 120) : "Transaction failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`rounded-xl border transition-colors ${expanded ? "border-slate-600 bg-slate-900/80" : "border-slate-800 bg-slate-900/40 hover:border-slate-700"}`}>
      {/* Summary row — always visible, click to expand */}
      <button
        onClick={onToggle}
        className="w-full text-left p-4"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${catColor}`}>
                {market.category}
              </span>
              <span className="text-xs text-slate-500">{daysLeft(market.endTime)}</span>
              <span className="text-xs text-slate-600">· {fmtVolume(total)} vol</span>
            </div>
            <p className="text-sm font-medium leading-snug text-slate-100">
              {market.question}
            </p>
            <ProbBar yes={market.yesPool} no={market.noPool} />
          </div>
          <div className="shrink-0 flex gap-2 text-center">
            <div className="w-14">
              <p className="text-[10px] text-slate-500">YES</p>
              <p className="text-sm font-bold text-green-400">{yesPct.toFixed(0)}¢</p>
            </div>
            <div className="w-14">
              <p className="text-[10px] text-slate-500">NO</p>
              <p className="text-sm font-bold text-red-400">{noPct.toFixed(0)}¢</p>
            </div>
            <div className="flex items-center pl-1">
              <svg
                className={`h-4 w-4 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      </button>

      {/* Expanded bet panel */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-800 pt-4">
          {chainId !== RH_TESTNET_ID && isConnected && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
              <span className="text-yellow-400 text-xs">⚠</span>
              <p className="text-xs text-yellow-300">
                Wrong network. Click Bet and you'll be prompted to switch to RH Chain Testnet.
              </p>
            </div>
          )}
          <p className="text-xs text-slate-500 mb-3 leading-relaxed">{market.description}</p>

          {/* YES / NO buttons */}
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => setSide(side === "yes" ? null : "yes")}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                side === "yes"
                  ? "border border-green-400 bg-green-500/20 text-green-300"
                  : "border border-green-500/20 bg-green-500/[0.07] text-green-500 hover:border-green-500/40"
              }`}
            >
              YES · {yesPct.toFixed(0)}¢
            </button>
            <button
              onClick={() => setSide(side === "no" ? null : "no")}
              className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-all ${
                side === "no"
                  ? "border border-red-400 bg-red-500/20 text-red-300"
                  : "border border-red-500/20 bg-red-500/[0.07] text-red-500 hover:border-red-500/40"
              }`}
            >
              NO · {noPct.toFixed(0)}¢
            </button>
          </div>

          {/* Amount + collateral */}
          <div className="flex gap-2 mb-3">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
            />
            <select
              value={collateral}
              onChange={(e) => setCollateral(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
            >
              {COLLATERAL_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <button
              onClick={handleBet}
              disabled={submitting || !side || !amount}
              className="rounded-lg bg-mint px-4 py-2 text-sm font-semibold text-navy disabled:opacity-40 whitespace-nowrap"
            >
              {submitting ? "..." : side ? `Bet ${side.toUpperCase()}` : "Select side"}
            </button>
          </div>

          {/* Payout preview */}
          {side && amount && parseFloat(amount) > 0 && (
            <div className="mb-3 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-xs text-slate-400 flex justify-between">
              <span>Est. payout if {side.toUpperCase()} wins</span>
              <span className="font-medium text-slate-200">
                {(parseFloat(amount) * (100 / (side === "yes" ? yesPct : noPct))).toFixed(4)} {collateral}
              </span>
            </div>
          )}

          {txStatus && (
            <p className="mt-1 break-all text-xs text-slate-400">{txStatus}</p>
          )}

          {/* Pool breakdown */}
          <div className="mt-3 flex gap-2 text-xs text-slate-600">
            <span>YES pool: {fmtVolume(market.yesPool)} {market.defaultCollateral}</span>
            <span>·</span>
            <span>NO pool: {fmtVolume(market.noPool)} {market.defaultCollateral}</span>
            <span>·</span>
            <span>2% protocol fee</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Polymarket reference card (in-app display only, betting via RWAForge) ─────

function PolyRefCard({
  market,
  expanded,
  onToggle,
}: {
  market: PolymarketMarket;
  expanded: boolean;
  onToggle: () => void;
}) {
  const yesPrice = parseFloat(market.outcomePrices[0] ?? "0.5");
  const noPrice = parseFloat(market.outcomePrices[1] ?? "0.5");
  const yesPct = yesPrice * 100;
  const noPct = noPrice * 100;
  const volumeNum = parseFloat(market.volume ?? "0");

  // Map to a native market id for betting — for now show "coming soon"
  const endTime = market.endDate ? new Date(market.endDate).getTime() : Date.now() + 7 * 86_400_000;

  return (
    <div className={`rounded-xl border transition-colors ${expanded ? "border-slate-600 bg-slate-900/80" : "border-slate-800 bg-slate-900/40 hover:border-slate-700"}`}>
      <button onClick={onToggle} className="w-full text-left p-4">
        <div className="flex items-start gap-3">
          {market.image && (
            <img src={market.image} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover mt-0.5" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
                Trending
              </span>
              {market.endDate && (
                <span className="text-xs text-slate-500">{daysLeft(endTime)}</span>
              )}
              <span className="text-xs text-slate-600">· {fmtVolume(volumeNum)} vol</span>
            </div>
            <p className="text-sm font-medium leading-snug text-slate-100">
              {market.question}
            </p>
            <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-400"
                style={{ width: `${yesPct.toFixed(1)}%` }}
              />
            </div>
          </div>
          <div className="shrink-0 flex gap-2 text-center">
            <div className="w-14">
              <p className="text-[10px] text-slate-500">{market.outcomes[0] ?? "Yes"}</p>
              <p className="text-sm font-bold text-green-400">{Math.round(yesPct)}¢</p>
            </div>
            <div className="w-14">
              <p className="text-[10px] text-slate-500">{market.outcomes[1] ?? "No"}</p>
              <p className="text-sm font-bold text-red-400">{Math.round(noPct)}¢</p>
            </div>
            <div className="flex items-center pl-1">
              <svg
                className={`h-4 w-4 text-slate-500 transition-transform ${expanded ? "rotate-180" : ""}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-800 pt-4">
          <div className="rounded-lg border border-mint/20 bg-mint/5 px-3 py-2.5 mb-3">
            <p className="text-xs text-mint font-medium mb-0.5">Bet on this via RWAForge</p>
            <p className="text-xs text-slate-400">
              This market is tracked from Polymarket as a reference. Native RWAForge on-chain support for trending markets coming in v2 — deploy <code className="text-slate-300">PredictionMarket.sol</code> and create a matching market to enable betting.
            </p>
          </div>
          <div className="flex gap-2 text-xs text-slate-600">
            <span>{market.outcomes[0] ?? "Yes"}: {Math.round(yesPct)}¢</span>
            <span>·</span>
            <span>{market.outcomes[1] ?? "No"}: {Math.round(noPct)}¢</span>
            <span>·</span>
            <span>{fmtVolume(volumeNum)} total volume</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── My Positions ──────────────────────────────────────────────────────────────

type Position = {
  id: number;
  question: string;
  side: "YES" | "NO";
  amount: bigint;
  outcome: number;
  isClaimed: boolean;
  collateral: string;
};

function MyPositions() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const contractAddress = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS as `0x${string}` | undefined;

  const [positions, setPositions] = useState<Position[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [claimStatus, setClaimStatus] = useState<Record<number, string>>({});

  const fetchPositions = useCallback(async () => {
    if (!address || !contractAddress) return;
    setLoaded(false);
    const found: Position[] = [];

    // Use ethers directly — avoids wagmi publicClient chain-pinning issues
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider("https://rpc.testnet.chain.robinhood.com");
    const ABI = [
      "function yesBets(uint256, address) view returns (uint256)",
      "function noBets(uint256, address) view returns (uint256)",
      "function claimed(uint256, address) view returns (bool)",
      "function getMarket(uint256) view returns (tuple(string question, address collateralToken, uint256 endTime, uint256 yesPool, uint256 noPool, uint8 outcome, address creator))",
    ];
    const pm = new ethers.Contract(contractAddress, ABI, provider);

    await Promise.all(
      NATIVE_MARKETS.map(async (m) => {
        try {
          const [yesBet, noBet, market, isClaimed] = await Promise.all([
            pm.yesBets(m.id, address) as Promise<bigint>,
            pm.noBets(m.id, address) as Promise<bigint>,
            pm.getMarket(m.id),
            pm.claimed(m.id, address) as Promise<boolean>,
          ]);

          const outcome = Number(market.outcome);

          if (yesBet > 0n) {
            found.push({ id: m.id, question: m.question, side: "YES", amount: yesBet, outcome, isClaimed, collateral: m.defaultCollateral });
          }
          if (noBet > 0n) {
            found.push({ id: m.id, question: m.question, side: "NO", amount: noBet, outcome, isClaimed, collateral: m.defaultCollateral });
          }
        } catch (e) {
          console.error("fetchPositions market", m.id, e);
        }
      })
    );

    found.sort((a, b) => a.id - b.id);
    setPositions(found);
    setLoaded(true);
  }, [address, contractAddress]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  if (!isConnected || !contractAddress) return null;

  const won = (p: Position) => (p.outcome === 1 && p.side === "YES") || (p.outcome === 2 && p.side === "NO");
  const lost = (p: Position) => (p.outcome === 1 && p.side === "NO") || (p.outcome === 2 && p.side === "YES");

  const handleClaim = async (marketId: number) => {
    if (!contractAddress) return;
    setClaiming(marketId);
    setClaimStatus((s) => ({ ...s, [marketId]: "Claiming..." }));
    try {
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: "claimWinnings",
        args: [BigInt(marketId)],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      setClaimStatus((s) => ({ ...s, [marketId]: `Claimed! ${hash.slice(0, 10)}…` }));
      fetchPositions();
    } catch (err) {
      setClaimStatus((s) => ({ ...s, [marketId]: err instanceof Error ? err.message.slice(0, 100) : "Failed" }));
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">My Positions</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {loaded ? `${positions.length} ${positions.length === 1 ? "bet" : "bets"} placed` : "Loading…"}
          </p>
          {address && (
            <p className="text-[10px] text-slate-600 mt-0.5 font-mono">{address.slice(0,6)}…{address.slice(-4)}</p>
          )}
        </div>
        <button onClick={fetchPositions} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
          Refresh
        </button>
      </div>

      {!loaded && (
        <div className="space-y-2">
          {[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-800/50" />)}
        </div>
      )}

      {loaded && positions.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-800 px-4 py-6 text-center">
          <p className="text-sm text-slate-500">No bets placed yet.</p>
          <p className="text-xs text-slate-600 mt-1">Your positions will appear here after you bet.</p>
        </div>
      )}

      {loaded && positions.length > 0 && (
        <div className="space-y-2">
          {positions.map((p) => (
            <div
              key={`${p.id}-${p.side}`}
              className={`rounded-xl border px-4 py-3 ${
                won(p) ? "border-green-500/30 bg-green-500/5" :
                lost(p) ? "border-red-500/20 bg-red-500/5 opacity-60" :
                p.outcome === 3 ? "border-slate-700 bg-slate-800/30" :
                "border-slate-700 bg-slate-900/40"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-200 line-clamp-2 leading-snug">{p.question}</p>
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      p.side === "YES" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {p.side}
                    </span>
                    <span className="text-xs text-slate-400">
                      {parseFloat(formatEther(p.amount)).toFixed(5)} {p.collateral}
                    </span>
                    <span className="text-slate-700">·</span>
                    <span className={`text-xs font-medium ${
                      won(p) ? "text-green-400" :
                      lost(p) ? "text-red-400" :
                      p.outcome === 3 ? "text-slate-400" :
                      "text-slate-500"
                    }`}>
                      {won(p) ? "Won" : lost(p) ? "Lost" : p.outcome === 3 ? "Cancelled" : "Open"}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  {p.outcome === 0 && (
                    <div>
                      <p className="text-[10px] text-slate-500">Staked</p>
                      <p className="text-sm font-semibold text-slate-200">
                        {parseFloat(formatEther(p.amount)).toFixed(5)} {p.collateral}
                      </p>
                    </div>
                  )}
                  {(won(p) || p.outcome === 3) && !p.isClaimed && (
                    <button
                      onClick={() => handleClaim(p.id)}
                      disabled={claiming === p.id}
                      className="rounded-lg bg-mint px-3 py-1.5 text-xs font-semibold text-navy disabled:opacity-50"
                    >
                      {claiming === p.id ? "..." : "Claim"}
                    </button>
                  )}
                  {p.isClaimed && (
                    <span className="text-xs text-slate-500">Claimed ✓</span>
                  )}
                </div>
              </div>
              {claimStatus[p.id] && (
                <p className="mt-1.5 text-xs text-slate-400 break-all">{claimStatus[p.id]}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PredictionMarkets() {
  const [polyMarkets, setPolyMarkets] = useState<PolymarketMarket[]>([]);
  const [loadingPoly, setLoadingPoly] = useState(true);
  const [filter, setFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"rwaforge" | "trending">("rwaforge");

  useEffect(() => {
    fetchFinanceMarkets()
      .then(setPolyMarkets)
      .catch(() => setPolyMarkets([]))
      .finally(() => setLoadingPoly(false));
  }, []);

  const filteredNative = filter
    ? NATIVE_MARKETS.filter((m) => m.question.toLowerCase().includes(filter.toLowerCase()))
    : NATIVE_MARKETS;

  const filteredPoly = filter
    ? polyMarkets.filter((m) => m.question.toLowerCase().includes(filter.toLowerCase()))
    : polyMarkets;

  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Prediction Markets</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Bet with ETH, USGD, or tokenized stocks — everything on RH Chain.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-mint/30 bg-mint/10 px-2.5 py-1 text-xs font-medium text-mint">
            Testnet
          </span>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 mb-4">
          <svg className="h-4 w-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search markets..."
            className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none"
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-1 mb-4">
          <button
            onClick={() => setTab("rwaforge")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              tab === "rwaforge" ? "bg-mint text-navy" : "text-slate-400 hover:text-slate-100"
            }`}
          >
            RWAForge Markets
          </button>
          <button
            onClick={() => setTab("trending")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              tab === "trending" ? "bg-mint text-navy" : "text-slate-400 hover:text-slate-100"
            }`}
          >
            Trending
            {polyMarkets.length > 0 && (
              <span className="ml-1.5 rounded-full bg-slate-700 px-1.5 py-0.5 text-[10px]">
                {filteredPoly.length}
              </span>
            )}
          </button>
        </div>

        {/* RWAForge native markets */}
        {tab === "rwaforge" && (
          <div className="space-y-2">
            {filteredNative.length === 0 && (
              <p className="text-center text-sm text-slate-500 py-8">No markets match your search.</p>
            )}
            {filteredNative.map((m) => (
              <NativeCard
                key={m.id}
                market={m}
                expanded={expandedId === `native-${m.id}`}
                onToggle={() => toggle(`native-${m.id}`)}
              />
            ))}
          </div>
        )}

        {/* Trending markets (Polymarket reference, in-app) */}
        {tab === "trending" && (
          <div className="space-y-2">
            {loadingPoly && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-800/60" />
                ))}
              </div>
            )}
            {!loadingPoly && filteredPoly.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-800 px-4 py-8 text-center">
                <p className="text-sm text-slate-500">No trending markets found.</p>
              </div>
            )}
            {filteredPoly.map((m) => (
              <PolyRefCard
                key={m.id}
                market={m}
                expanded={expandedId === `poly-${m.id}`}
                onToggle={() => toggle(`poly-${m.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      <MyPositions />

      {/* Footer info */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 px-5 py-4">
        <p className="text-xs leading-relaxed text-slate-500">
          <span className="font-medium text-slate-400">Supported collateral:</span>{" "}
          Native ETH, USGD, and any tokenized stock on RH Chain (AAPL, TSLA, NVDA…).
          Winners receive proportional share of the total pool minus a 2% protocol fee.
          Markets resolved by RWAForge operators.
        </p>
      </div>
    </div>
  );
}
