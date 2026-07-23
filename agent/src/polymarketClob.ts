/**
 * polymarketClob.ts
 * Polymarket CLOB API client.
 *
 * Auth: Polymarket uses L1 authentication headers (wallet signature of a
 * timestamp) for private endpoints. Orders are signed via EIP-712.
 *
 * Docs: https://docs.polymarket.com/#clob-client
 */

import axios from "axios";
import { ethers } from "ethers";
import { config } from "./config";

const BASE = config.polymarketClobUrl;

// ── Auth ────────────────────────────────────────────────────────────────────

function buildL1Headers(wallet: ethers.Wallet, method: string, path: string, body = "") {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "0";
  const message = `${timestamp}\n${method}\n${path}\n${body}`;
  const sig = wallet.signMessageSync(message);
  return {
    "POLY_ADDRESS": wallet.address,
    "POLY_SIGNATURE": sig,
    "POLY_TIMESTAMP": timestamp,
    "POLY_NONCE": nonce,
  };
}

export function getClobWallet(): ethers.Wallet {
  return new ethers.Wallet(config.operatorPolygonPrivateKey);
}

// ── API Key management ───────────────────────────────────────────────────────

export async function createOrGetApiKey(wallet: ethers.Wallet): Promise<{
  apiKey: string;
  secret: string;
  passphrase: string;
}> {
  const path = "/auth/api-key";
  const headers = buildL1Headers(wallet, "POST", path);
  const res = await axios.post(`${BASE}${path}`, {}, { headers });
  return res.data;
}

// ── Market info ──────────────────────────────────────────────────────────────

export interface ClobMarket {
  conditionId: string;
  questionId: string;
  question: string;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  tokens: Array<{
    token_id: string; // clobTokenId for YES (index 0) and NO (index 1)
    outcome: string;
    price: number;
  }>;
}

export async function getMarket(conditionId: string): Promise<ClobMarket | null> {
  try {
    const res = await axios.get(`${BASE}/markets/${conditionId}`);
    return res.data;
  } catch {
    return null;
  }
}

export async function getMarketByTokenId(tokenId: string): Promise<ClobMarket | null> {
  try {
    const res = await axios.get(`${BASE}/markets`, { params: { clob_token_id: tokenId } });
    const items = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
    return items[0] ?? null;
  } catch {
    return null;
  }
}

// ── Order placement ──────────────────────────────────────────────────────────

export interface PlaceOrderParams {
  tokenId: string;     // clobTokenId of the outcome being bought
  side: "BUY" | "SELL";
  price: number;       // e.g. 0.65 for 65¢
  sizeUsdc: number;    // USDC amount to spend (e.g. 100 for $100)
}

export interface PlacedOrder {
  orderId: string;
  status: string;
}

/**
 * Place a market-price limit order on the Polymarket CLOB.
 * sizeUsdc is the USDC amount; price is what we're willing to pay per share.
 * shares = sizeUsdc / price.
 */
export async function placeOrder(
  wallet: ethers.Wallet,
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  params: PlaceOrderParams
): Promise<PlacedOrder> {
  const salt = Math.floor(Math.random() * 1_000_000_000);
  const shares = params.sizeUsdc / params.price;
  // Convert to USDC units (6 decimals)
  const makerAmount = Math.round(params.sizeUsdc * 1e6);
  const takerAmount = Math.round(shares * 1e6);

  // EIP-712 order struct
  const domain = {
    name: "Polymarket CTF Exchange",
    version: "1",
    chainId: 137,
    verifyingContract: config.polymarketCtfExchange,
  };

  const types = {
    Order: [
      { name: "salt", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "signer", type: "address" },
      { name: "taker", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "makerAmount", type: "uint256" },
      { name: "takerAmount", type: "uint256" },
      { name: "expiration", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "feeRateBps", type: "uint256" },
      { name: "side", type: "uint8" },
      { name: "signatureType", type: "uint8" },
    ],
  };

  const orderData = {
    salt,
    maker: wallet.address,
    signer: wallet.address,
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: BigInt(params.tokenId),
    makerAmount: BigInt(makerAmount),
    takerAmount: BigInt(takerAmount),
    expiration: 0n,
    nonce: 0n,
    feeRateBps: 0n,
    side: params.side === "BUY" ? 0 : 1,
    signatureType: 0,
  };

  const signature = await wallet.signTypedData(domain, types, orderData);

  const path = "/order";
  const body = JSON.stringify({
    order: { ...orderData, signature, tokenId: params.tokenId.toString(), makerAmount: makerAmount.toString(), takerAmount: takerAmount.toString() },
    owner: wallet.address,
    orderType: "GTC",
  });

  const headers = {
    ...buildL1Headers(wallet, "POST", path, body),
    "Content-Type": "application/json",
    "POLY_API_KEY": apiKey,
    "POLY_API_SECRET": apiSecret,
    "POLY_API_PASSPHRASE": passphrase,
  };

  const res = await axios.post(`${BASE}${path}`, body, { headers });
  return { orderId: res.data.orderID, status: res.data.status };
}

// ── Position monitoring ──────────────────────────────────────────────────────

export interface UserPosition {
  conditionId: string;
  tokenId: string;
  outcome: string;
  size: number;       // shares held
  avgPrice: number;
  currentPrice: number;
  resolved: boolean;
  winner: boolean | null; // null if not resolved
}

export async function getPositions(
  wallet: ethers.Wallet,
  apiKey: string,
  apiSecret: string,
  passphrase: string
): Promise<UserPosition[]> {
  const path = "/positions";
  const headers = {
    ...buildL1Headers(wallet, "GET", path),
    "POLY_API_KEY": apiKey,
    "POLY_API_SECRET": apiSecret,
    "POLY_API_PASSPHRASE": passphrase,
  };
  const res = await axios.get(`${BASE}${path}`, { headers, params: { user: wallet.address } });
  const raw = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
  return raw.map((p: any) => ({
    conditionId: p.conditionId ?? p.condition_id,
    tokenId: p.tokenId ?? p.token_id,
    outcome: p.outcome,
    size: parseFloat(p.size ?? "0"),
    avgPrice: parseFloat(p.avgPrice ?? p.avg_price ?? "0"),
    currentPrice: parseFloat(p.curPrice ?? p.current_price ?? "0"),
    resolved: !!p.resolved,
    winner: p.winner ?? null,
  }));
}

/**
 * Check if a specific conditionId market has resolved and who won.
 * Returns { resolved: true, winnerTokenId } if resolved, else { resolved: false }.
 */
export async function checkResolution(conditionId: string): Promise<{
  resolved: boolean;
  winnerIndex: number | null; // 0 = YES won, 1 = NO won
}> {
  const market = await getMarket(conditionId);
  if (!market) return { resolved: false, winnerIndex: null };
  if (!market.closed) return { resolved: false, winnerIndex: null };

  // Find which token has price = 1.0 (winner) or 0.0 (loser)
  const yesPrice = market.tokens[0]?.price ?? 0;
  if (yesPrice >= 0.99) return { resolved: true, winnerIndex: 0 };
  if (yesPrice <= 0.01) return { resolved: true, winnerIndex: 1 };
  return { resolved: false, winnerIndex: null };
}

/**
 * Redeem winning CTF shares for USDC on Polymarket.
 * Winning shares resolve to 1 USDC each.
 */
export async function redeemWinnings(
  wallet: ethers.Wallet,
  apiKey: string,
  apiSecret: string,
  passphrase: string,
  conditionId: string
): Promise<number> {
  // Polymarket auto-redeems winning positions after resolution.
  // Poll positions until the USDC balance increases or position shows redeemed.
  const positions = await getPositions(wallet, apiKey, apiSecret, passphrase);
  const pos = positions.find((p) => p.conditionId === conditionId && p.winner === true);
  if (!pos) return 0;
  // Winning shares × $1 = USDC value
  return pos.size;
}
