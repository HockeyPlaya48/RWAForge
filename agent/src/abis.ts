export const predictVaultAbi = [
  {
    type: "event",
    name: "CollateralLocked",
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "token", type: "address", indexed: false },
      { name: "grossAmount", type: "uint256", indexed: false },
      { name: "bookingFee", type: "uint256", indexed: false },
      { name: "netAmount", type: "uint256", indexed: false },
      { name: "marketId", type: "bytes32", indexed: false },
      { name: "outcomeIndex", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WinSettled",
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "grossPayout", type: "uint256", indexed: false },
      { name: "winFee", type: "uint256", indexed: false },
      { name: "userPayout", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "LossSettled",
    inputs: [
      { name: "positionId", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
    ],
  },
  {
    type: "function",
    name: "settleWin",
    inputs: [
      { name: "positionId", type: "uint256" },
      { name: "grossPayout", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "settleLoss",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "cancelPosition",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getPosition",
    inputs: [{ name: "positionId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "token", type: "address" },
          { name: "netAmount", type: "uint256" },
          { name: "marketId", type: "bytes32" },
          { name: "outcomeIndex", type: "uint8" },
          { name: "status", type: "uint8" },
          { name: "payoutAmount", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
] as const;

// LayerZero V2 OFT (send USDC cross-chain)
export const oftAbi = [
  {
    type: "function",
    name: "send",
    inputs: [
      {
        name: "sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
      {
        name: "fee",
        type: "tuple",
        components: [
          { name: "nativeFee", type: "uint256" },
          { name: "lzTokenFee", type: "uint256" },
        ],
      },
      { name: "refundAddress", type: "address" },
    ],
    outputs: [
      { name: "msgReceipt", type: "tuple", components: [{ name: "guid", type: "bytes32" }, { name: "nonce", type: "uint64" }, { name: "fee", type: "tuple", components: [{ name: "nativeFee", type: "uint256" }, { name: "lzTokenFee", type: "uint256" }] }] },
      { name: "oftReceipt", type: "tuple", components: [{ name: "amountSentLD", type: "uint256" }, { name: "amountReceivedLD", type: "uint256" }] },
    ],
    stateMutability: "payable",
  },
  {
    type: "function",
    name: "quoteSend",
    inputs: [
      {
        name: "sendParam",
        type: "tuple",
        components: [
          { name: "dstEid", type: "uint32" },
          { name: "to", type: "bytes32" },
          { name: "amountLD", type: "uint256" },
          { name: "minAmountLD", type: "uint256" },
          { name: "extraOptions", type: "bytes" },
          { name: "composeMsg", type: "bytes" },
          { name: "oftCmd", type: "bytes" },
        ],
      },
      { name: "payInLzToken", type: "bool" },
    ],
    outputs: [
      {
        name: "fee",
        type: "tuple",
        components: [
          { name: "nativeFee", type: "uint256" },
          { name: "lzTokenFee", type: "uint256" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

// Uniswap V3 Universal Router (exactInputSingle)
export const uniswapRouterAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
    stateMutability: "payable",
  },
] as const;
