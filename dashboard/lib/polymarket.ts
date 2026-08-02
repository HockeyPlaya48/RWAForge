export interface PolymarketMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  endDate: string;
}

const GAMMA_API = "https://gamma-api.polymarket.com";
const PAGES = 4;
const PAGE_SIZE = 100;

function parseField(field: unknown): string[] {
  if (Array.isArray(field)) return field as string[];
  if (typeof field === "string") {
    try {
      return JSON.parse(field);
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Fetches a pool of currently-active, non-closed Polymarket markets (top few
 * hundred by volume). Polymarket's public-search endpoint returns closed/expired
 * markets mixed in with live ones (verified: e.g. every NVDA weekly-contract
 * result from public-search was already resolved) - this only ever uses the
 * active=true&closed=false market list, so a "no match" result means no live
 * market was found, not a stale one being shown as if it were live.
 */
export async function fetchActiveMarketPool(): Promise<PolymarketMarket[]> {
  const pages = await Promise.all(
    Array.from({ length: PAGES }, (_, i) =>
      fetch(
        `${GAMMA_API}/markets?active=true&closed=false&limit=${PAGE_SIZE}&offset=${i * PAGE_SIZE}&order=volume&ascending=false`,
        { cache: "no-store" }
      )
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => [])
    )
  );

  const items = pages.flatMap((p) => (Array.isArray(p) ? p : (p?.data ?? [])));

  return items.map((m: any) => ({
    id: m.id ?? "",
    question: m.question ?? "",
    slug: m.slug ?? m.id ?? "",
    outcomes: parseField(m.outcomes),
    outcomePrices: parseField(m.outcomePrices),
    volume: m.volume ?? "0",
    endDate: m.endDate ?? "",
  }));
}

/** Best-effort keyword match against an already-fetched active-market pool. Returns null if nothing matches - never falls back to a stale market. */
export function findReferenceMarket(pool: PolymarketMarket[], keyword: string): PolymarketMarket | null {
  const kw = keyword.toLowerCase();
  const match = pool.find((m) => m.question.toLowerCase().includes(kw));
  return match ?? null;
}
