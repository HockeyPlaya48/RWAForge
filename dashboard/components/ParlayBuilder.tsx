"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { decodeEventLog, formatUnits, parseUnits } from "viem";

const RH_TESTNET_ID = 46630;
const ETH_SENTINEL = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/**
 * One base market id per distinct real-world question — deliberately excludes the
 * TSLA-collateral duplicate ids (6, 10, 11, 12), since those settle on the exact
 * same real-world outcome as their ETH counterpart. Including both would let a
 * "parlay" bundle the same event twice under two different ids, which isn't a real
 * combo, just double-counting one leg.
 */
const LEG_CATALOGUE: { id: number; question: string }[] = [
  { id: 0, question: "Will tokenized AAPL on RH Chain exceed $220 by end of Q3 2026?" },
  { id: 1, question: "Will the Federal Reserve cut rates in September 2026?" },
  { id: 2, question: "Will tokenized TSLA exceed $350 before October 2026?" },
  { id: 3, question: "Will RWAForge reach $1M total distribution volume by Oct 2026?" },
  { id: 4, question: "Will Bitcoin exceed $120,000 before October 2026?" },
  { id: 5, question: "Will NVIDIA beat Q3 2026 earnings estimates?" },
  { id: 7, question: "Will the New York Mets beat the Cleveland Guardians tonight (Aug 4, 2026)?" },
  { id: 8, question: "Will Aryna Sabalenka beat Moyuka Uchijima at the National Bank Open?" },
  { id: 9, question: "Will Andrey Rublev beat Juncheng Shang at the National Bank Open?" },
];

/** Collateral offered for a NEW combo's own stake — independent of each leg's collateral. Only verified real tokens. */
const COMBO_COLLATERAL_OPTIONS: { label: string; address: `0x${string}` }[] = [
  { label: "ETH", address: ETH_SENTINEL },
  { label: "TSLA", address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E" },
];

const COMBO_MARKET_ABI = [
  {
    type: "function", name: "createCombo",
    inputs: [
      { name: "legMarketIds", type: "uint256[]" },
      { name: "legPicks", type: "bool[]" },
      { name: "collateralToken", type: "address" },
      { name: "endTime", type: "uint256" },
    ],
    outputs: [{ name: "comboId", type: "uint256" }], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "betCombo",
    inputs: [{ name: "comboId", type: "uint256" }, { name: "isYes", type: "bool" }, { name: "amount", type: "uint256" }],
    outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "betComboETH",
    inputs: [{ name: "comboId", type: "uint256" }, { name: "isYes", type: "bool" }],
    outputs: [], stateMutability: "payable",
  },
  {
    type: "function", name: "resolveCombo",
    inputs: [{ name: "comboId", type: "uint256" }], outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "claimComboWinnings",
    inputs: [{ name: "comboId", type: "uint256" }], outputs: [], stateMutability: "nonpayable",
  },
  {
    type: "function", name: "previewComboPayout",
    inputs: [{ name: "comboId", type: "uint256" }, { name: "user", type: "address" }],
    outputs: [{ name: "", type: "uint256" }], stateMutability: "view",
  },
  {
    type: "function", name: "claimed",
    inputs: [{ name: "", type: "uint256" }, { name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }], stateMutability: "view",
  },
  {
    type: "function", name: "nextComboId",
    inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view",
  },
  {
    type: "function", name: "getCombo",
    inputs: [{ name: "comboId", type: "uint256" }],
    outputs: [
      { name: "legMarketIds", type: "uint256[]" },
      { name: "legPicks", type: "bool[]" },
      { name: "collateralToken", type: "address" },
      { name: "endTime", type: "uint256" },
      { name: "yesPool", type: "uint256" },
      { name: "noPool", type: "uint256" },
      { name: "outcome", type: "uint8" },
      { name: "creator", type: "address" },
    ],
    stateMutability: "view",
  },
  {
    type: "event", name: "ComboCreated",
    inputs: [
      { name: "comboId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "legMarketIds", type: "uint256[]", indexed: false },
      { name: "legPicks", type: "bool[]", indexed: false },
      { name: "collateralToken", type: "address", indexed: false },
      { name: "endTime", type: "uint256", indexed: false },
    ],
  },
] as const;

const PREDICTION_MARKET_MIN_ABI = [
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

function fmtAmount(n: number): string {
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

type LegState = {
  id: number;
  question: string;
  endTime: bigint;
  outcome: number;
  yesPool: bigint;
  noPool: bigint;
};

/** Live state for every leg in the catalogue — open/resolved status, endTime, and odds. */
function useLegCatalogue() {
  const publicClient = usePublicClient({ chainId: RH_TESTNET_ID });
  const contractAddress = process.env.NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS as `0x${string}` | undefined;
  const [legs, setLegs] = useState<Record<number, LegState>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!contractAddress || !publicClient) { setLoading(false); return; }
    setLoading(true);
    try {
      const results = await Promise.all(
        LEG_CATALOGUE.map((l) =>
          publicClient.readContract({
            address: contractAddress, abi: PREDICTION_MARKET_MIN_ABI, functionName: "getMarket", args: [BigInt(l.id)],
          })
        )
      );
      const next: Record<number, LegState> = {};
      LEG_CATALOGUE.forEach((l, i) => {
        const m = results[i];
        next[l.id] = { id: l.id, question: l.question, endTime: m.endTime, outcome: Number(m.outcome), yesPool: m.yesPool, noPool: m.noPool };
      });
      setLegs(next);
    } finally {
      setLoading(false);
    }
  }, [contractAddress, publicClient]);

  useEffect(() => { refresh(); }, [refresh]);
  return { legs, loading, refresh };
}

// ── Builder: pick 2+ open legs, choose collateral + stake, create + bet in one flow ──

function BuildParlay({ legs, legsLoading, onCreated }: { legs: Record<number, LegState>; legsLoading: boolean; onCreated: () => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: RH_TESTNET_ID });
  const comboAddress = process.env.NEXT_PUBLIC_COMBO_MARKET_ADDRESS as `0x${string}` | undefined;

  const [picks, setPicks] = useState<Record<number, boolean>>({}); // legId -> isYes (presence = selected)
  const [collateral, setCollateral] = useState(COMBO_COLLATERAL_OPTIONS[0]);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openLegs = LEG_CATALOGUE.filter((l) => legs[l.id] && legs[l.id].outcome === 0);
  const selectedIds = Object.keys(picks).map(Number);

  // Combined implied probability from each leg's CURRENT pool odds (not the combo's own,
  // usually-empty pool). Same idea as a sportsbook parlay calculator: multiply each leg's
  // odds together. This is an estimate, not a promise — real payout is pari-mutuel and
  // depends on what others have staked into this exact combo by the time it resolves.
  const legProbabilities = selectedIds.map((id) => {
    const leg = legs[id];
    const total = Number(formatUnits(leg.yesPool + leg.noPool, 18));
    if (total === 0) return 0.5;
    const pickPool = Number(formatUnits(picks[id] ? leg.yesPool : leg.noPool, 18));
    return Math.max(pickPool / total, 0.01); // floor at 1% so a single 0-volume side doesn't imply infinite odds
  });
  const combinedProbability = legProbabilities.reduce((acc, p) => acc * p, 1);
  const impliedMultiplier = combinedProbability > 0 ? (1 / combinedProbability) * 0.98 : 0; // × (1 - 2% protocol fee)
  const parsedAmount = parseFloat(amount) || 0;
  const estimatedPayout = parsedAmount * impliedMultiplier;

  const toggleLeg = (id: number) => {
    setPicks((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = true;
      return next;
    });
    setStatus(null);
  };

  const setPick = (id: number, isYes: boolean) => {
    setPicks((prev) => ({ ...prev, [id]: isYes }));
  };

  const handleCreateAndBet = async () => {
    if (!isConnected || !address) { setStatus("Connect your wallet first."); return; }
    if (selectedIds.length < 2) { setStatus("Pick at least 2 legs."); return; }
    if (!amount || parseFloat(amount) <= 0) { setStatus("Enter a stake amount."); return; }
    if (!comboAddress) { setStatus("ComboMarket not deployed — set NEXT_PUBLIC_COMBO_MARKET_ADDRESS."); return; }
    if (!publicClient) { setStatus("Still connecting — try again in a moment."); return; }

    setSubmitting(true);
    setStatus("Submitting...");
    try {
      if (chainId !== RH_TESTNET_ID) {
        setStatus("Switching to RH Chain Testnet...");
        await switchChainAsync({ chainId: RH_TESTNET_ID });
      }

      const legMarketIds = selectedIds.map((id) => BigInt(id));
      const legPicks = selectedIds.map((id) => picks[id]);
      const endTime = selectedIds.reduce((min, id) => {
        const legEnd = legs[id].endTime;
        return min === 0n || legEnd < min ? legEnd : min;
      }, 0n);

      setStatus("Creating combo...");
      const createHash = await writeContractAsync({
        address: comboAddress, abi: COMBO_MARKET_ABI, functionName: "createCombo",
        args: [legMarketIds, legPicks, collateral.address, endTime],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

      let comboId: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: COMBO_MARKET_ABI, data: log.data, topics: log.topics });
          if (decoded.eventName === "ComboCreated") { comboId = decoded.args.comboId; break; }
        } catch { /* not our event, skip */ }
      }
      if (comboId === null) throw new Error("Couldn't find ComboCreated event in receipt.");

      const isEth = collateral.address.toLowerCase() === ETH_SENTINEL.toLowerCase();
      let decimals = 18;
      let betHash: `0x${string}`;
      if (isEth) {
        const parsedAmount = parseUnits(amount, 18);
        setStatus("Placing your stake...");
        betHash = await writeContractAsync({
          address: comboAddress, abi: COMBO_MARKET_ABI, functionName: "betComboETH",
          args: [comboId, true], value: parsedAmount,
        });
      } else {
        decimals = await publicClient.readContract({ address: collateral.address, abi: ERC20_MIN_ABI, functionName: "decimals" });
        const parsedAmount = parseUnits(amount, decimals);
        const currentAllowance = await publicClient.readContract({
          address: collateral.address, abi: ERC20_MIN_ABI, functionName: "allowance", args: [address, comboAddress],
        });
        if (currentAllowance < parsedAmount) {
          setStatus(`Approving ${collateral.label}...`);
          const approveHash = await writeContractAsync({
            address: collateral.address, abi: ERC20_MIN_ABI, functionName: "approve", args: [comboAddress, parsedAmount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        setStatus("Placing your stake...");
        betHash = await writeContractAsync({
          address: comboAddress, abi: COMBO_MARKET_ABI, functionName: "betCombo",
          args: [comboId, true, parsedAmount],
        });
      }
      await publicClient.waitForTransactionReceipt({ hash: betHash });

      setStatus(`Parlay #${comboId} created and staked! ${betHash.slice(0, 10)}…`);
      setPicks({});
      setAmount("");
      onCreated();
    } catch (err) {
      setStatus(err instanceof Error ? err.message.slice(0, 160) : "Transaction failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <h3 className="text-sm font-semibold text-slate-100">Build a parlay</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Pick 2+ open markets and a side for each. All picks must hit for your stake to win — payout is pari-mutuel
        from whoever bets the "hits" side vs. the "misses" side of this exact combo, same as any other RWAForge
        market. No fixed odds, no house bankroll.
      </p>

      {legsLoading && <p className="mt-4 text-xs text-slate-500">Loading open markets…</p>}

      {!legsLoading && (
        <div className="mt-4 space-y-2">
          {openLegs.length === 0 && <p className="text-xs text-slate-500">No open markets available to combo right now.</p>}
          {openLegs.map((l) => {
            const selected = l.id in picks;
            const leg = legs[l.id];
            const total = Number(formatUnits(leg.yesPool + leg.noPool, 18));
            const yesPct = total > 0 ? (Number(formatUnits(leg.yesPool, 18)) / total) * 100 : 50;
            return (
              <div key={l.id} className={`rounded-lg border px-3 py-2 transition-colors ${selected ? "border-mint/40 bg-mint/[0.04]" : "border-slate-800"}`}>
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={selected} onChange={() => toggleLeg(l.id)} className="h-4 w-4 shrink-0 accent-mint" />
                  <button onClick={() => toggleLeg(l.id)} className="min-w-0 flex-1 text-left text-xs text-slate-300">
                    {l.question}
                  </button>
                  <span className="shrink-0 text-[10px] text-slate-600">{yesPct.toFixed(0)}¢ YES</span>
                  {selected && (
                    <div className="shrink-0 flex gap-1">
                      <button
                        onClick={() => setPick(l.id, true)}
                        className={`rounded px-2 py-1 text-[10px] font-semibold ${picks[l.id] ? "bg-green-500/20 text-green-300" : "text-slate-500 hover:text-green-400"}`}
                      >YES</button>
                      <button
                        onClick={() => setPick(l.id, false)}
                        className={`rounded px-2 py-1 text-[10px] font-semibold ${!picks[l.id] ? "bg-red-500/20 text-red-300" : "text-slate-500 hover:text-red-400"}`}
                      >NO</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <select
          value={collateral.label}
          onChange={(e) => setCollateral(COMBO_COLLATERAL_OPTIONS.find((c) => c.label === e.target.value) ?? COMBO_COLLATERAL_OPTIONS[0])}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
        >
          {COMBO_COLLATERAL_OPTIONS.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
        </select>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={`Stake in ${collateral.label}`}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-mint focus:outline-none"
        />
        <button
          onClick={handleCreateAndBet}
          disabled={submitting || selectedIds.length < 2 || !amount}
          className="rounded-lg bg-mint px-4 py-2 text-sm font-semibold text-navy disabled:opacity-40 whitespace-nowrap"
        >
          {submitting ? "..." : `Create parlay (${selectedIds.length} legs)`}
        </button>
      </div>

      {selectedIds.length >= 2 && (
        <div className="mt-3 rounded-lg border border-mint/20 bg-mint/[0.04] px-3 py-2 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">
              Combined odds <span className="text-slate-200 font-medium">{impliedMultiplier.toFixed(2)}×</span> from current leg odds
            </p>
            <p className="text-[10px] text-slate-600 mt-0.5">
              Estimate only — actual payout is pari-mutuel and depends on the pool at resolution, same as every RWAForge market.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] text-slate-500">Est. payout if all hit</p>
            <p className="text-sm font-semibold text-mint">{estimatedPayout.toFixed(4)} {collateral.label}</p>
          </div>
        </div>
      )}

      {status && <p className="mt-2 break-all text-xs text-slate-400">{status}</p>}
    </div>
  );
}

// ── Active parlays: browse/bet/resolve/claim existing combos ──────────────────

type ComboState = {
  id: number;
  legMarketIds: readonly bigint[];
  legPicks: readonly boolean[];
  collateralToken: `0x${string}`;
  endTime: bigint;
  yesPool: bigint;
  noPool: bigint;
  outcome: number;
  creator: `0x${string}`;
};

function useCombos() {
  const publicClient = usePublicClient({ chainId: RH_TESTNET_ID });
  const comboAddress = process.env.NEXT_PUBLIC_COMBO_MARKET_ADDRESS as `0x${string}` | undefined;
  const [combos, setCombos] = useState<ComboState[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!comboAddress || !publicClient) { setLoading(false); return; }
    setLoading(true);
    try {
      const count = await publicClient.readContract({ address: comboAddress, abi: COMBO_MARKET_ABI, functionName: "nextComboId" });
      const ids = Array.from({ length: Number(count) }, (_, i) => i);
      const results = await Promise.all(
        ids.map((id) => publicClient.readContract({ address: comboAddress, abi: COMBO_MARKET_ABI, functionName: "getCombo", args: [BigInt(id)] }))
      );
      setCombos(
        ids.map((id, i) => {
          const [legMarketIds, legPicks, collateralToken, endTime, yesPool, noPool, outcome, creator] = results[i];
          return { id, legMarketIds, legPicks, collateralToken, endTime, yesPool, noPool, outcome, creator };
        }).reverse()
      );
    } finally {
      setLoading(false);
    }
  }, [comboAddress, publicClient]);

  useEffect(() => { refresh(); }, [refresh]);
  return { combos, loading, refresh };
}

function ParlayCard({ combo, legs, onChanged }: { combo: ComboState; legs: Record<number, LegState>; onChanged: () => void }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: RH_TESTNET_ID });
  const comboAddress = process.env.NEXT_PUBLIC_COMBO_MARKET_ADDRESS as `0x${string}` | undefined;

  const [symbol, setSymbol] = useState("…");
  const [decimals, setDecimals] = useState(18);
  const [side, setSide] = useState<"yes" | "no" | null>(null);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const isEth = combo.collateralToken.toLowerCase() === ETH_SENTINEL.toLowerCase();
    if (isEth) { setSymbol("ETH"); setDecimals(18); return; }
    if (!publicClient) return;
    Promise.all([
      publicClient.readContract({ address: combo.collateralToken, abi: ERC20_MIN_ABI, functionName: "symbol" }),
      publicClient.readContract({ address: combo.collateralToken, abi: ERC20_MIN_ABI, functionName: "decimals" }),
    ]).then(([s, d]) => { setSymbol(s); setDecimals(Number(d)); }).catch(() => setSymbol("?"));
  }, [combo.collateralToken, publicClient]);

  const total = Number(formatUnits(combo.yesPool + combo.noPool, decimals));
  const yesPool = Number(formatUnits(combo.yesPool, decimals));
  const yesPct = total > 0 ? (yesPool / total) * 100 : 50;
  const noPct = 100 - yesPct;

  const allLegsResolved = combo.legMarketIds.every((id) => legs[Number(id)]?.outcome !== 0 && legs[Number(id)] !== undefined);
  const comboBettingClosed = Date.now() >= Number(combo.endTime) * 1000;
  const canResolve = combo.outcome === 0 && comboBettingClosed && allLegsResolved;

  const handleBet = async () => {
    if (!isConnected || !address) { setStatus("Connect your wallet first."); return; }
    if (!side) { setStatus("Select a side."); return; }
    if (!amount || parseFloat(amount) <= 0) { setStatus("Enter an amount."); return; }
    if (!comboAddress || !publicClient) { setStatus("Still loading — try again."); return; }

    setBusy(true);
    setStatus("Submitting...");
    try {
      if (chainId !== RH_TESTNET_ID) {
        setStatus("Switching to RH Chain Testnet...");
        await switchChainAsync({ chainId: RH_TESTNET_ID });
      }
      const isYes = side === "yes";
      const isEth = combo.collateralToken.toLowerCase() === ETH_SENTINEL.toLowerCase();
      const parsedAmount = parseUnits(amount, decimals);
      let hash: `0x${string}`;
      if (isEth) {
        hash = await writeContractAsync({
          address: comboAddress, abi: COMBO_MARKET_ABI, functionName: "betComboETH", args: [BigInt(combo.id), isYes], value: parsedAmount,
        });
      } else {
        const currentAllowance = await publicClient.readContract({
          address: combo.collateralToken, abi: ERC20_MIN_ABI, functionName: "allowance", args: [address, comboAddress],
        });
        if (currentAllowance < parsedAmount) {
          setStatus(`Approving ${symbol}...`);
          const approveHash = await writeContractAsync({
            address: combo.collateralToken, abi: ERC20_MIN_ABI, functionName: "approve", args: [comboAddress, parsedAmount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        hash = await writeContractAsync({
          address: comboAddress, abi: COMBO_MARKET_ABI, functionName: "betCombo", args: [BigInt(combo.id), isYes, parsedAmount],
        });
      }
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus(`Bet placed! ${hash.slice(0, 10)}…`);
      setSide(null);
      setAmount("");
      onChanged();
    } catch (err) {
      setStatus(err instanceof Error ? err.message.slice(0, 160) : "Transaction failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleResolve = async () => {
    if (!comboAddress || !publicClient) return;
    setBusy(true);
    setStatus("Resolving...");
    try {
      const hash = await writeContractAsync({ address: comboAddress, abi: COMBO_MARKET_ABI, functionName: "resolveCombo", args: [BigInt(combo.id)] });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus("Resolved.");
      onChanged();
    } catch (err) {
      setStatus(err instanceof Error ? err.message.slice(0, 160) : "Resolve failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = async () => {
    if (!comboAddress || !publicClient) return;
    setBusy(true);
    setStatus("Claiming...");
    try {
      const hash = await writeContractAsync({ address: comboAddress, abi: COMBO_MARKET_ABI, functionName: "claimComboWinnings", args: [BigInt(combo.id)] });
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus("Claimed!");
      onChanged();
    } catch (err) {
      setStatus(err instanceof Error ? err.message.slice(0, 160) : "Claim failed.");
    } finally {
      setBusy(false);
    }
  };

  const outcomeLabel = ["Open", "Hit — all legs won", "Missed — a leg lost", "Cancelled"][combo.outcome];
  const outcomeColor = ["text-slate-400", "text-green-400", "text-red-400", "text-slate-400"][combo.outcome];

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <span className="rounded border border-purple-500/20 bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400">
          Parlay · {combo.legMarketIds.length} legs
        </span>
        <span className={`text-xs font-medium ${outcomeColor}`}>{outcomeLabel}</span>
      </div>

      <ul className="space-y-1 mb-3">
        {combo.legMarketIds.map((id, i) => {
          const leg = legs[Number(id)];
          const pick = combo.legPicks[i];
          return (
            <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
              <span className={`shrink-0 font-bold ${pick ? "text-green-400" : "text-red-400"}`}>{pick ? "YES" : "NO"}</span>
              <span className="min-w-0">{leg?.question ?? `Market #${id}`}</span>
            </li>
          );
        })}
      </ul>

      <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden mb-2">
        <div className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-400" style={{ width: `${yesPct.toFixed(1)}%` }} />
      </div>
      <p className="text-[10px] text-slate-600 mb-3">
        Hits: {yesPct.toFixed(0)}¢ · Misses: {noPct.toFixed(0)}¢ · {fmtAmount(total)} {symbol} pool
      </p>

      {combo.outcome === 0 && (
        <>
          <div className="flex gap-2 mb-2">
            <button
              onClick={() => setSide(side === "yes" ? null : "yes")}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold ${side === "yes" ? "border border-green-400 bg-green-500/20 text-green-300" : "border border-green-500/20 bg-green-500/[0.07] text-green-500"}`}
            >Bet HITS</button>
            <button
              onClick={() => setSide(side === "no" ? null : "no")}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold ${side === "no" ? "border border-red-400 bg-red-500/20 text-red-300" : "border border-red-500/20 bg-red-500/[0.07] text-red-500"}`}
            >Bet MISSES</button>
          </div>
          <div className="flex gap-2">
            <input
              type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder={`Amount in ${symbol}`}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-mint focus:outline-none"
            />
            <button
              onClick={handleBet} disabled={busy || !side || !amount}
              className="rounded-lg bg-mint px-3 py-1.5 text-xs font-semibold text-navy disabled:opacity-40"
            >{busy ? "..." : "Bet"}</button>
          </div>
          {canResolve && (
            <button onClick={handleResolve} disabled={busy} className="mt-2 w-full rounded-lg border border-slate-700 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-40">
              All legs resolved — settle this parlay
            </button>
          )}
        </>
      )}

      {combo.outcome !== 0 && (
        <button onClick={handleClaim} disabled={busy} className="w-full rounded-lg bg-mint px-3 py-1.5 text-xs font-semibold text-navy disabled:opacity-40">
          {busy ? "..." : "Claim (if you have a winning position)"}
        </button>
      )}

      {status && <p className="mt-2 break-all text-xs text-slate-400">{status}</p>}
    </div>
  );
}

export function ParlayBuilder() {
  const { legs, loading: legsLoading, refresh: refreshLegs } = useLegCatalogue();
  const { combos, loading: combosLoading, refresh: refreshCombos } = useCombos();
  const comboAddress = process.env.NEXT_PUBLIC_COMBO_MARKET_ADDRESS;

  const refreshAll = () => { refreshLegs(); refreshCombos(); };

  if (!comboAddress) return null;

  return (
    <div className="space-y-4">
      <BuildParlay legs={legs} legsLoading={legsLoading} onCreated={refreshAll} />

      <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="text-sm font-semibold text-slate-100 mb-3">Active parlays</h3>
        {combosLoading && <p className="text-xs text-slate-500">Loading…</p>}
        {!combosLoading && combos.length === 0 && <p className="text-xs text-slate-500">No parlays created yet — build one above.</p>}
        <div className="space-y-3">
          {combos.map((c) => <ParlayCard key={c.id} combo={c} legs={legs} onChanged={refreshAll} />)}
        </div>
      </div>
    </div>
  );
}
