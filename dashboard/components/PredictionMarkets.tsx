"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";

const RH_TESTNET_ID = 46630;
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

import { formatUnits, parseUnits } from "viem";
import { fetchActiveMarketPool, findReferenceMarket, findReferenceMarketById, type PolymarketMarket } from "@/lib/polymarket";
import { ParlayBuilder } from "@/components/ParlayBuilder";

// ── ABI ───────────────────────────────────────────────────────────────────────

const PREDICTION_MARKET_ABI = [
  {
    type: "function", name: "nextMarketId",
    inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view",
  },
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

const ERC20_MIN_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

// ── Native RWAForge markets (static metadata not stored on-chain) ─────────────

/**
 * A market "variant" is one real on-chain market (one collateral token, fixed
 * at creation). Multiple variants can share the same real-world question when
 * more than one collateral-specific market exists for it - e.g. the TSLA
 * question below has both an ETH-collateralized and a TSLA-collateralized
 * on-chain market. The collateral dropdown only ever lists variants that
 * genuinely exist on-chain; it never offers a collateral with no real market
 * behind it (that was the original bug - see git history).
 */
type MarketVariant = {
  id: number;
  /** Static label for the dropdown, based on a verified real token - not a guess. */
  collateralLabel: string;
};

type NativeMarketGroup = {
  groupId: string;
  question: string;
  description: string;
  category: string;
  /** Keyword to best-effort match against live Polymarket markets for reference odds. Omit if no real-world equivalent exists. */
  pmKeyword?: string;
  /** Exact Polymarket market id for one-off event markets (a specific game/match), where a keyword could ambiguously match more than one live market. Takes priority over pmKeyword when set. */
  pmId?: string;
  /** Index into the matched market's outcomePrices that corresponds to OUR question's YES side. Polymarket lists "Team A vs Team B" outcomes in whatever order they choose, which doesn't always put our YES subject first. Defaults to 0. */
  pmYesIndex?: number;
  variants: MarketVariant[];
};

const NATIVE_MARKET_GROUPS: NativeMarketGroup[] = [
  {
    groupId: "aapl-220",
    question: "Will tokenized AAPL on RH Chain exceed $220 by end of Q3 2026?",
    description: "Resolves YES if AAPL closes above $220 on September 30, 2026 per Robinhood's tokenized equity price feed.",
    category: "Stocks",
    pmKeyword: "apple",
    variants: [
      { id: 0, collateralLabel: "ETH" },
      { id: 13, collateralLabel: "TSLA" },
    ],
  },
  {
    groupId: "fed-sep26",
    question: "Will the Federal Reserve cut rates in September 2026?",
    description: "Resolves YES if the FOMC announces a rate cut at the September 2026 meeting.",
    category: "Macro",
    pmKeyword: "fed",
    variants: [
      { id: 1, collateralLabel: "ETH" },
      { id: 14, collateralLabel: "TSLA" },
    ],
  },
  {
    groupId: "tsla-350",
    question: "Will tokenized TSLA exceed $350 before October 2026?",
    description: "Resolves YES if TSLA's tokenized price on RH Chain closes above $350 on any trading day before October 1, 2026. Pick a collateral below — each is a separate real on-chain market, so switching also switches which pool you're betting into.",
    category: "Stocks",
    pmKeyword: "tesla",
    variants: [
      { id: 2, collateralLabel: "ETH" },
      { id: 6, collateralLabel: "TSLA" },
    ],
  },
  {
    groupId: "rwaforge-1m",
    question: "Will RWAForge reach $1M total distribution volume by Oct 2026?",
    description: "Resolves YES if the cumulative USD value distributed via RWAForge DistributionRouter exceeds $1,000,000 before November 1, 2026.",
    category: "RWAForge",
    // No pmKeyword - this is RWAForge-specific, no real-world market exists for it.
    variants: [
      { id: 3, collateralLabel: "ETH" },
      { id: 15, collateralLabel: "TSLA" },
    ],
  },
  {
    groupId: "btc-120k",
    question: "Will Bitcoin exceed $120,000 before October 2026?",
    description: "Resolves YES if BTC/USD on any major exchange closes above $120,000 before October 1, 2026.",
    category: "Crypto",
    pmKeyword: "bitcoin",
    variants: [
      { id: 4, collateralLabel: "ETH" },
      { id: 16, collateralLabel: "TSLA" },
    ],
  },
  {
    groupId: "nvda-q3",
    question: "Will NVIDIA beat Q3 2026 earnings estimates?",
    description: "Resolves YES if NVIDIA reports Q3 2026 EPS above analyst consensus estimates at time of market creation.",
    category: "Stocks",
    pmKeyword: "nvidia",
    variants: [
      { id: 5, collateralLabel: "ETH" },
      { id: 17, collateralLabel: "TSLA" },
    ],
  },
];

/** Every on-chain market id already claimed by a curated group above - the dynamic
 * sports scanner below skips these so nothing is ever shown twice. */
const STATIC_MARKET_IDS = new Set(NATIVE_MARKET_GROUPS.flatMap((g) => g.variants.map((v) => v.id)));

/** Known collateral tokens we can label without an extra RPC call. */
const KNOWN_COLLATERAL_LABELS: Record<string, string> = {
  [ETH_SENTINEL.toLowerCase()]: "ETH",
  "0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e": "TSLA",
};

function labelForCollateral(token: string): string {
  return KNOWN_COLLATERAL_LABELS[token.toLowerCase()] ?? `${token.slice(0, 6)}…`;
}

/** Flat list of every real on-chain market in the curated groups - used where grouping doesn't matter (e.g. scanning for a user's positions). */
const STATIC_MARKET_VARIANTS = NATIVE_MARKET_GROUPS.flatMap((g) =>
  g.variants.map((v) => ({ id: v.id, question: g.question }))
);

/**
 * Sports and crypto Up/Down markets aren't hardcoded - a daily job creates sports
 * markets from real live games (Polymarket's moneyline markets), and a rolling sync
 * keeps one live BTC/ETH "exceed $X in the next hour?" market open per asset (real
 * Coinbase prices). This hook discovers whatever the contract currently has beyond
 * the curated list above, grouping same-question ETH/TSLA pairs into one dropdown
 * card exactly like the curated groups. No redeploy needed for new markets to show
 * up; only the newest ones stay visible so old, resolved ones age out on their own.
 */
const MAX_DYNAMIC_MARKET_IDS = 30;
const CRYPTO_QUESTION_PATTERN = /^Will (BTC|ETH) exceed \$/;

function useDynamicMarketGroups() {
  const publicClient = usePublicClient({ chainId: RH_TESTNET_ID });
  const contractAddress = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS as `0x${string}` | undefined;
  const [groups, setGroups] = useState<NativeMarketGroup[]>([]);
  const [allVariants, setAllVariants] = useState<{ id: number; question: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!contractAddress || !publicClient) { setLoading(false); return; }
    setLoading(true);
    try {
      const nextId = await publicClient.readContract({ address: contractAddress, abi: PREDICTION_MARKET_ABI, functionName: "nextMarketId" });
      const allIds = Array.from({ length: Number(nextId) }, (_, i) => i).filter((id) => !STATIC_MARKET_IDS.has(id));
      const recentIds = allIds.slice(-MAX_DYNAMIC_MARKET_IDS);

      const markets = await Promise.all(
        recentIds.map((id) => publicClient.readContract({ address: contractAddress, abi: PREDICTION_MARKET_ABI, functionName: "getMarket", args: [BigInt(id)] }))
      );

      const now = Date.now();
      type GroupWithState = NativeMarketGroup & { stillOpen: boolean };
      const byQuestion = new Map<string, GroupWithState>();
      recentIds.forEach((id, i) => {
        const m = markets[i];
        if (!m.question) return;
        const variantOpen = Number(m.outcome) === 0 && Number(m.endTime) * 1000 > now;
        const existing = byQuestion.get(m.question);
        const variant = { id, collateralLabel: labelForCollateral(m.collateralToken) };
        const isCrypto = CRYPTO_QUESTION_PATTERN.test(m.question);
        if (existing) {
          existing.variants.push(variant);
          existing.stillOpen = existing.stillOpen || variantOpen;
        } else {
          byQuestion.set(m.question, {
            groupId: `dyn-${id}`,
            question: m.question,
            description: isCrypto
              ? "A live 1-hour market on real Coinbase spot price - resolves against the actual close price at expiry, not an estimate."
              : "A live moneyline market created from today's real games (sourced from Polymarket) - not a fixed, hand-written question.",
            category: isCrypto ? "Crypto" : "Sports",
            variants: [variant],
            stillOpen: variantOpen,
          });
        }
      });

      // Once betting closes on every variant of a game, drop it from the browse list -
      // the next daily run brings in a fresh game to replace it. Closed/resolved markets
      // stay fully claimable; they just aren't surfaced here anymore.
      const all = Array.from(byQuestion.values());
      setGroups(all.filter((g) => g.stillOpen).reverse());
      setAllVariants(all.flatMap((g) => g.variants.map((v) => ({ id: v.id, question: g.question }))));
    } finally {
      setLoading(false);
    }
  }, [contractAddress, publicClient]);

  useEffect(() => { refresh(); }, [refresh]);
  return { groups, allVariants, loading, refresh };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Formats a token-unit amount (not a USD estimate — we have no price feed). */
function fmtAmount(n: number): string {
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function daysLeft(endTimeMs: number): string {
  const d = Math.ceil((endTimeMs - Date.now()) / 86_400_000);
  if (d < 0) return "Resolving";
  if (d === 0) return "Ends today";
  return `${d}d left`;
}

const CATEGORY_COLORS: Record<string, string> = {
  Stocks: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  Macro: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  Crypto: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
  Sports: "text-orange-400 bg-orange-500/10 border-orange-500/20",
  RWAForge: "text-mint bg-mint/10 border-mint/20",
  Market: "text-slate-400 bg-slate-500/10 border-slate-500/20",
};

const CATEGORY_ICONS: Record<string, string> = {
  Stocks: "📈",
  Macro: "🏛",
  Crypto: "₿",
  Sports: "🏆",
  RWAForge: "⚡",
  Market: "◆",
};

// ── On-chain market data ────────────────────────────────────────────────────

type OnchainMarket = {
  collateralToken: `0x${string}`;
  endTime: bigint;
  yesPool: bigint;
  noPool: bigint;
  outcome: number;
};

type CollateralInfo = {
  isEth: boolean;
  symbol: string;
  decimals: number;
};

/** Fetches live market state + resolves the real collateral token's symbol/decimals. */
function useOnchainMarket(marketId: number) {
  const publicClient = usePublicClient({ chainId: RH_TESTNET_ID });
  const contractAddress = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS as `0x${string}` | undefined;

  const [onchain, setOnchain] = useState<OnchainMarket | null>(null);
  const [collateral, setCollateral] = useState<CollateralInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!contractAddress || !publicClient) {
      setLoading(false);
      setError("Prediction market contract address not configured.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const m = await publicClient.readContract({
        address: contractAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: "getMarket",
        args: [BigInt(marketId)],
      });
      const data: OnchainMarket = {
        collateralToken: m.collateralToken,
        endTime: m.endTime,
        yesPool: m.yesPool,
        noPool: m.noPool,
        outcome: m.outcome,
      };
      setOnchain(data);

      const isEth = data.collateralToken.toLowerCase() === ETH_SENTINEL.toLowerCase();
      if (isEth) {
        setCollateral({ isEth: true, symbol: "ETH", decimals: 18 });
      } else {
        const [symbol, decimals] = await Promise.all([
          publicClient.readContract({ address: data.collateralToken, abi: ERC20_MIN_ABI, functionName: "symbol" }),
          publicClient.readContract({ address: data.collateralToken, abi: ERC20_MIN_ABI, functionName: "decimals" }),
        ]);
        setCollateral({ isEth: false, symbol, decimals: Number(decimals) });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load market");
    } finally {
      setLoading(false);
    }
  }, [contractAddress, publicClient, marketId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { onchain, collateral, loading, error, refresh, contractAddress, publicClient };
}

// ── Native market card with inline bet form ───────────────────────────────────

function NativeCard({
  group,
  expanded,
  onToggle,
  referencePool,
}: {
  group: NativeMarketGroup;
  expanded: boolean;
  onToggle: () => void;
  referencePool: PolymarketMarket[];
}) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [selectedId, setSelectedId] = useState(group.variants[0].id);
  const selectedVariant = group.variants.find((v) => v.id === selectedId) ?? group.variants[0];
  const { onchain, collateral, loading, error, refresh, contractAddress, publicClient } = useOnchainMarket(selectedId);

  const reference = group.pmId
    ? findReferenceMarketById(referencePool, group.pmId)
    : group.pmKeyword
    ? findReferenceMarket(referencePool, group.pmKeyword)
    : null;
  const yesIndex = group.pmYesIndex ?? 0;
  const referenceYesPct = reference ? parseFloat(reference.outcomePrices[yesIndex] ?? "0.5") * 100 : null;

  const [side, setSide] = useState<"yes" | "no" | null>(null);
  const [amount, setAmount] = useState("");
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleVariantChange = (id: number) => {
    setSelectedId(id);
    setSide(null);
    setAmount("");
    setTxStatus(null);
  };

  const catColor = CATEGORY_COLORS[group.category] ?? CATEGORY_COLORS.Market;

  const decimals = collateral?.decimals ?? 18;
  const yesPool = onchain ? Number(formatUnits(onchain.yesPool, decimals)) : 0;
  const noPool = onchain ? Number(formatUnits(onchain.noPool, decimals)) : 0;
  const total = yesPool + noPool;
  const yesPct = total > 0 ? (yesPool / total) * 100 : 50;
  const noPct = 100 - yesPct;
  const symbol = collateral?.symbol ?? "…";
  const endTimeMs = onchain ? Number(onchain.endTime) * 1000 : Date.now();

  const handleBet = async () => {
    if (!isConnected || !address) { setTxStatus("Connect your wallet first."); return; }
    if (!side) { setTxStatus("Select YES or NO."); return; }
    if (!amount || parseFloat(amount) <= 0) { setTxStatus("Enter an amount."); return; }
    if (!contractAddress) { setTxStatus("PredictionMarket not deployed — set NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS."); return; }
    if (!onchain || !collateral || !publicClient) { setTxStatus("Still loading market data — try again in a moment."); return; }

    setSubmitting(true);
    setTxStatus("Submitting...");
    try {
      if (chainId !== RH_TESTNET_ID) {
        setTxStatus("Switching to RH Chain Testnet...");
        await switchChainAsync({ chainId: RH_TESTNET_ID });
      }

      const isYes = side === "yes";
      const parsedAmount = parseUnits(amount, collateral.decimals);
      let hash: `0x${string}`;

      if (collateral.isEth) {
        hash = await writeContractAsync({
          address: contractAddress,
          abi: PREDICTION_MARKET_ABI,
          functionName: "betETH",
          args: [BigInt(selectedId), isYes],
          value: parsedAmount,
        });
      } else {
        // ERC-20 collateral: this market's `bet()` calls transferFrom internally,
        // so an insufficient allowance must be topped up first or the tx reverts.
        const currentAllowance = await publicClient.readContract({
          address: onchain.collateralToken,
          abi: ERC20_MIN_ABI,
          functionName: "allowance",
          args: [address, contractAddress],
        });
        if (currentAllowance < parsedAmount) {
          setTxStatus(`Approving ${symbol}...`);
          const approveHash = await writeContractAsync({
            address: onchain.collateralToken,
            abi: ERC20_MIN_ABI,
            functionName: "approve",
            args: [contractAddress, parsedAmount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        setTxStatus("Submitting bet...");
        hash = await writeContractAsync({
          address: contractAddress,
          abi: PREDICTION_MARKET_ABI,
          functionName: "bet",
          args: [BigInt(selectedId), isYes, parsedAmount],
        });
      }

      await publicClient.waitForTransactionReceipt({ hash });
      setTxStatus(`Bet placed! ${hash.slice(0, 10)}…`);
      setSide(null);
      setAmount("");
      await refresh();
    } catch (err) {
      setTxStatus(err instanceof Error ? err.message.slice(0, 160) : "Transaction failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Compact grid tile — click opens the full detail/bet panel */}
      <button
        onClick={onToggle}
        className="flex h-full w-full flex-col rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-left transition-colors hover:border-slate-600"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-sm ${catColor}`}>
            {CATEGORY_ICONS[group.category] ?? CATEGORY_ICONS.Market}
          </span>
          <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${catColor}`}>
            {group.category}
          </span>
          <span className="ml-auto text-[10px] text-slate-600">{loading && !onchain ? "…" : daysLeft(endTimeMs)}</span>
        </div>

        <p className="line-clamp-3 flex-1 text-sm font-medium leading-snug text-slate-100">
          {group.question}
        </p>

        <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-400" style={{ width: `${yesPct.toFixed(1)}%` }} />
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-xs font-bold text-green-400">{loading && !onchain ? "…" : `${yesPct.toFixed(0)}¢ YES`}</span>
          <span className="text-xs font-bold text-red-400">{loading && !onchain ? "…" : `${noPct.toFixed(0)}¢ NO`}</span>
        </div>
        <p className="mt-2 text-[10px] text-slate-600">{loading && !onchain ? "…" : `${fmtAmount(total)} ${symbol} vol`}</p>
      </button>

      {/* Detail / bet modal */}
      {expanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onToggle}>
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${catColor}`}>
                  {group.category}
                </span>
                <p className="mt-2 text-sm font-semibold leading-snug text-slate-100">{group.question}</p>
              </div>
              <button onClick={onToggle} className="shrink-0 text-slate-500 hover:text-slate-300" aria-label="Close">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {chainId !== RH_TESTNET_ID && isConnected && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
                <span className="text-yellow-400 text-xs">⚠</span>
                <p className="text-xs text-yellow-300">
                  Wrong network. Click Bet and you'll be prompted to switch to RH Chain Testnet.
                </p>
              </div>
            )}
            {error && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
                <p className="text-xs text-red-300">Couldn't load live market data: {error}</p>
              </div>
            )}
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">{group.description}</p>

            {reference && referenceYesPct !== null && (
              <div className="mb-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-600">
                  Reference — a related, separate market on Polymarket (not what your bet settles against)
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-xs text-slate-400 truncate">{reference.question}</p>
                  <a
                    href={`https://polymarket.com/event/${reference.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs font-medium text-mint hover:underline"
                  >
                    {Math.round(referenceYesPct)}¢ YES ↗
                  </a>
                </div>
              </div>
            )}

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

            {/* Collateral — only shown as a dropdown when more than one real on-chain market exists for this question */}
            {group.variants.length > 1 && (
              <div className="mb-3">
                <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-600">
                  Collateral (each option is a separate real market with its own pool)
                </label>
                <select
                  value={selectedId}
                  onChange={(e) => handleVariantChange(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
                >
                  {group.variants.map((v) => (
                    <option key={v.id} value={v.id}>{v.collateralLabel}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Amount */}
            <div className="flex gap-2 mb-3">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={`Amount in ${symbol}`}
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
              />
              <span className="flex items-center rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-300">
                {symbol}
              </span>
              <button
                onClick={handleBet}
                disabled={submitting || !side || !amount || loading}
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
                  {(parseFloat(amount) * (100 / (side === "yes" ? yesPct : noPct))).toFixed(4)} {symbol}
                </span>
              </div>
            )}

            {txStatus && (
              <p className="mt-1 break-all text-xs text-slate-400">{txStatus}</p>
            )}

            {/* Pool breakdown — live on-chain values */}
            <div className="mt-3 flex gap-2 text-xs text-slate-600">
              <span>YES pool: {fmtAmount(yesPool)} {symbol}</span>
              <span>·</span>
              <span>NO pool: {fmtAmount(noPool)} {symbol}</span>
              <span>·</span>
              <span>2% protocol fee</span>
            </div>
          </div>
        </div>
      )}
    </>
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
  symbol: string;
  decimals: number;
  yesPool: bigint;
  noPool: bigint;
};

const PAYOUT_FEE_BPS = 200n; // 2%, matches the contract's default feeBps

/**
 * Same math as PredictionMarket._computePayout, computed client-side. For an open
 * market this is a live estimate (the pool can still move before resolution); for a
 * resolved one the pool is frozen, so this is exactly what claiming will pay out.
 */
function expectedPayout(p: Position): bigint {
  const sidePool = p.side === "YES" ? p.yesPool : p.noPool;
  if (sidePool === 0n) return 0n;
  const payablePool = ((p.yesPool + p.noPool) * (10_000n - PAYOUT_FEE_BPS)) / 10_000n;
  return (p.amount * payablePool) / sidePool;
}

function MyPositions({ variants }: { variants: { id: number; question: string }[] }) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: RH_TESTNET_ID });
  const contractAddress = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS as `0x${string}` | undefined;

  const [positions, setPositions] = useState<Position[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [claiming, setClaiming] = useState<number | null>(null);
  const [claimStatus, setClaimStatus] = useState<Record<number, string>>({});

  const fetchPositions = useCallback(async () => {
    if (!address || !contractAddress || !publicClient) return;
    setLoaded(false);
    const found: Position[] = [];

    await Promise.all(
      variants.map(async (m) => {
        try {
          const [yesBet, noBet, market, isClaimed] = await Promise.all([
            publicClient.readContract({ address: contractAddress, abi: PREDICTION_MARKET_ABI, functionName: "yesBets", args: [BigInt(m.id), address] }),
            publicClient.readContract({ address: contractAddress, abi: PREDICTION_MARKET_ABI, functionName: "noBets", args: [BigInt(m.id), address] }),
            publicClient.readContract({ address: contractAddress, abi: PREDICTION_MARKET_ABI, functionName: "getMarket", args: [BigInt(m.id)] }),
            publicClient.readContract({ address: contractAddress, abi: PREDICTION_MARKET_ABI, functionName: "claimed", args: [BigInt(m.id), address] }),
          ]);

          const outcome = Number(market.outcome);
          const isEth = market.collateralToken.toLowerCase() === ETH_SENTINEL.toLowerCase();
          let symbol = "ETH";
          let decimals = 18;
          if (!isEth) {
            const [s, d] = await Promise.all([
              publicClient.readContract({ address: market.collateralToken, abi: ERC20_MIN_ABI, functionName: "symbol" }),
              publicClient.readContract({ address: market.collateralToken, abi: ERC20_MIN_ABI, functionName: "decimals" }),
            ]);
            symbol = s;
            decimals = Number(d);
          }

          if (yesBet > 0n) {
            found.push({ id: m.id, question: m.question, side: "YES", amount: yesBet, outcome, isClaimed, symbol, decimals, yesPool: market.yesPool, noPool: market.noPool });
          }
          if (noBet > 0n) {
            found.push({ id: m.id, question: m.question, side: "NO", amount: noBet, outcome, isClaimed, symbol, decimals, yesPool: market.yesPool, noPool: market.noPool });
          }
        } catch (e) {
          console.error("fetchPositions market", m.id, e);
        }
      })
    );

    found.sort((a, b) => a.id - b.id);
    setPositions(found);
    setLoaded(true);
  }, [address, contractAddress, publicClient, variants]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  if (!isConnected || !contractAddress) return null;

  const won = (p: Position) => (p.outcome === 1 && p.side === "YES") || (p.outcome === 2 && p.side === "NO");
  const lost = (p: Position) => (p.outcome === 1 && p.side === "NO") || (p.outcome === 2 && p.side === "YES");

  const handleClaim = async (marketId: number) => {
    if (!contractAddress || !publicClient) return;
    setClaiming(marketId);
    setClaimStatus((s) => ({ ...s, [marketId]: "Claiming..." }));
    try {
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: PREDICTION_MARKET_ABI,
        functionName: "claimWinnings",
        args: [BigInt(marketId)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
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
                      {fmtAmount(Number(formatUnits(p.amount, p.decimals)))} {p.symbol}
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
                  {p.outcome === 0 && (() => {
                    const payout = expectedPayout(p);
                    const net = payout - p.amount;
                    const profitable = net >= 0n;
                    return (
                      <div>
                        <p className="text-[10px] text-slate-500">Staked</p>
                        <p className="text-sm font-semibold text-slate-200">
                          {fmtAmount(Number(formatUnits(p.amount, p.decimals)))} {p.symbol}
                        </p>
                        <p className="mt-1 text-[10px] text-slate-500">Total back if {p.side} wins</p>
                        <p className="text-xs font-medium text-mint">
                          {fmtAmount(Number(formatUnits(payout, p.decimals)))} {p.symbol}
                        </p>
                        <p className={`text-[10px] ${profitable ? "text-green-400" : "text-yellow-500"}`}>
                          {profitable ? "+" : ""}{fmtAmount(Number(formatUnits(net, p.decimals)))} {p.symbol}{" "}
                          {profitable ? "profit" : "net — fee with no one on the other side yet"}
                        </p>
                      </div>
                    );
                  })()}
                  {won(p) && !p.isClaimed && (() => {
                    const payout = expectedPayout(p);
                    const net = payout - p.amount;
                    const profitable = net >= 0n;
                    return (
                      <div className="mb-1">
                        <p className="text-xs font-medium text-mint">
                          {fmtAmount(Number(formatUnits(payout, p.decimals)))} {p.symbol}
                        </p>
                        <p className={`text-[10px] ${profitable ? "text-green-400" : "text-yellow-500"}`}>
                          {profitable ? "+" : ""}{fmtAmount(Number(formatUnits(net, p.decimals)))} {p.symbol}{" "}
                          {profitable ? "profit" : "net"}
                        </p>
                      </div>
                    );
                  })()}
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

const ALL_CATEGORIES = ["All", "Sports", "Crypto", "Stocks", "Macro", "RWAForge"] as const;

export function PredictionMarkets() {
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<(typeof ALL_CATEGORIES)[number]>("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [referencePool, setReferencePool] = useState<PolymarketMarket[]>([]);
  const { groups: dynamicGroups, allVariants: dynamicVariants, loading: dynamicLoading, refresh: refreshDynamicGroups } = useDynamicMarketGroups();

  useEffect(() => {
    fetchActiveMarketPool()
      .then(setReferencePool)
      .catch(() => setReferencePool([]));
  }, []);

  // Keep a live BTC/ETH "up or down" hour open - fire-and-forget, idempotent, safe to
  // call on every page load. First visitor after a window expires rolls it forward.
  useEffect(() => {
    fetch("/api/markets/sync-crypto")
      .then(() => refreshDynamicGroups())
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allGroups = [...NATIVE_MARKET_GROUPS, ...dynamicGroups];
  const allVariants = [...STATIC_MARKET_VARIANTS, ...dynamicVariants];

  const filteredGroups = allGroups
    .filter((g) => category === "All" || g.category === category)
    .filter((g) => !filter || g.question.toLowerCase().includes(filter.toLowerCase()));

  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-100">Prediction Markets</h2>
              <span className="flex items-center gap-1 rounded-full border border-mint/20 bg-mint/10 px-2 py-0.5 text-[11px] font-medium text-mint">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mint" />
                </span>
                {filteredGroups.length} live
              </span>
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              Odds, pools, and positions read live from the deployed contract on RH Chain Testnet.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-mint/30 bg-mint/10 px-2.5 py-1 text-xs font-medium text-mint">
            Testnet
          </span>
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {ALL_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                category === c ? "bg-mint text-navy" : "bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800"
              }`}
            >
              {c}
            </button>
          ))}
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

        {/* Native markets */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredGroups.length === 0 && (
            <p className="col-span-full text-center text-sm text-slate-500 py-8">No markets match your search.</p>
          )}
          {filteredGroups.map((g) => (
            <NativeCard
              key={g.groupId}
              group={g}
              expanded={expandedId === `native-${g.groupId}`}
              onToggle={() => toggle(`native-${g.groupId}`)}
              referencePool={referencePool}
            />
          ))}
        </div>
        {dynamicLoading && <p className="text-center text-xs text-slate-600 py-2 mt-2">Loading today's live sports and crypto markets…</p>}
      </div>

      <MyPositions variants={allVariants} />

      <ParlayBuilder />

      {/* Footer info */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 px-5 py-4">
        <p className="text-xs leading-relaxed text-slate-500">
          <span className="font-medium text-slate-400">Collateral:</span>{" "}
          Each market's accepted collateral is fixed at creation — the amount field above shows exactly which
          token a given market requires, read live from the contract. Most markets accept both ETH and TSLA as
          separate real pools, selectable from the dropdown. Winners receive a proportional share of the total
          pool minus a 2% protocol fee. Markets resolved by RWAForge operators. Where shown, "Reference" odds are
          a separate, related market on Polymarket for context only, sourced live from Polymarket's public API —
          your bet settles against RWAForge's own pool, not Polymarket's.{" "}
          <span className="font-medium text-slate-400">Sports markets</span> (MLB, ATP/WTA tennis) are created
          fresh daily from real, currently-live games — old ones roll off automatically as new ones are created.{" "}
          <span className="font-medium text-slate-400">Crypto markets</span> (BTC, ETH) roll forward every hour and
          resolve against Coinbase's real close price for that exact window, not an estimate.
        </p>
      </div>
    </div>
  );
}
