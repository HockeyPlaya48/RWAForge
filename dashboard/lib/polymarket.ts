export interface PolymarketMarket {
  id: string;
  conditionId: string;
  clobTokenIds: string[]; // [YES token id, NO token id] — used for embed URL
  question: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  liquidity: string;
  endDate: string;
  image: string | null;
}

const GAMMA_API = "https://gamma-api.polymarket.com";

// Keywords that indicate finance/RWA-relevant markets
const FINANCE_KEYWORDS = [
  "stock", "share", "equity", "market", "s&p", "nasdaq", "dow",
  "fed", "federal reserve", "rate", "inflation", "gdp", "recession",
  "earnings", "ipo", "merger", "acquisition", "sec",
  "apple", "tesla", "nvidia", "microsoft", "amazon", "google", "meta",
  "bitcoin", "crypto", "btc", "eth", "ethereum",
  "oil", "gold", "silver", "commodity",
  "dollar", "euro", "yen", "currency", "forex",
  "bond", "treasury", "yield", "interest",
  "trade", "tariff", "economy", "economic",
];

function isFinanceMarket(question: string): boolean {
  const q = question.toLowerCase();
  return FINANCE_KEYWORDS.some((kw) => q.includes(kw));
}

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

export async function fetchFinanceMarkets(): Promise<PolymarketMarket[]> {
  // Fetch a large batch sorted by volume, then filter to finance-relevant markets
  const res = await fetch(
    `${GAMMA_API}/markets?active=true&closed=false&limit=200&order=volume&ascending=false`,
    { cache: "no-store" }
  );

  if (!res.ok) throw new Error(`Polymarket API error: ${res.status}`);

  const raw = await res.json();
  const items: any[] = Array.isArray(raw) ? raw : (raw.data ?? []);

  return items
    .filter((m) => m.active && !m.closed && isFinanceMarket(m.question ?? ""))
    .slice(0, 30)
    .map((m) => ({
      id: m.id ?? "",
      conditionId: m.conditionId ?? "",
      clobTokenIds: parseField(m.clobTokenIds),
      question: m.question ?? "",
      slug: m.slug ?? m.id ?? "",
      outcomes: parseField(m.outcomes),
      outcomePrices: parseField(m.outcomePrices),
      volume: m.volume ?? "0",
      liquidity: m.liquidity ?? "0",
      endDate: m.endDate ?? "",
      image: m.image ?? null,
    }));
}
