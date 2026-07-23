import "dotenv/config";

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const config = {
  // Robinhood Chain
  rhChainRpc: required("RH_CHAIN_RPC"),
  rhChainId: 4663,
  predictVaultAddress: required("PREDICT_VAULT_ADDRESS") as `0x${string}`,
  operatorPrivateKey: required("OPERATOR_PRIVATE_KEY") as `0x${string}`,
  rhChainStartBlock: BigInt(process.env.RH_CHAIN_START_BLOCK ?? "0"),

  // Polygon
  polygonRpc: required("POLYGON_RPC"),
  polygonChainId: 137,
  operatorPolygonPrivateKey: (process.env.OPERATOR_POLYGON_PRIVATE_KEY ?? required("OPERATOR_PRIVATE_KEY")) as `0x${string}`,
  usdcPolygon: (process.env.USDC_POLYGON ?? "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359") as `0x${string}`,
  polymarketUsdc: (process.env.POLYMARKET_USDC ?? "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174") as `0x${string}`,

  // LayerZero
  lzEndpointRhChain: required("LZ_ENDPOINT_RH_CHAIN") as `0x${string}`,
  lzEndpointPolygon: (process.env.LZ_ENDPOINT_POLYGON ?? "0x1a44076050125825900e736c501f859c50fE728c") as `0x${string}`,
  lzEidRhChain: parseInt(required("LZ_EID_RH_CHAIN")),
  lzEidPolygon: parseInt(process.env.LZ_EID_POLYGON ?? "30109"),
  usdcOftRhChain: required("USDC_OFT_RH_CHAIN") as `0x${string}`,
  usdcOftPolygon: required("USDC_OFT_POLYGON") as `0x${string}`,

  // Uniswap V3 (Polygon)
  uniswapRouterPolygon: (process.env.UNISWAP_ROUTER_POLYGON ?? "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD") as `0x${string}`,
  uniswapQuoterPolygon: (process.env.UNISWAP_QUOTER_POLYGON ?? "0x61fFE014bA17989E743c5F6cB21bF9697530B21e") as `0x${string}`,

  // Polymarket CLOB
  polymarketClobUrl: process.env.POLYMARKET_CLOB_URL ?? "https://clob.polymarket.com",
  polymarketCtfExchange: (process.env.POLYMARKET_CTF_EXCHANGE ?? "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E") as `0x${string}`,
  polymarketNegRiskExchange: (process.env.POLYMARKET_NEG_RISK_EXCHANGE ?? "0xC5d563A36AE78145C45a50134d48A1215220f80a") as `0x${string}`,

  // Agent
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS ?? "15000"),
};
