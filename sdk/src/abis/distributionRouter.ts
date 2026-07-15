export const distributionRouterAbi = [
  {
    type: "function",
    name: "distribute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [
      { name: "totalDistributed", type: "uint256" },
      { name: "feeCharged", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "feeBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "treasury",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "event",
    name: "DistributionExecuted",
    inputs: [
      { name: "distributor", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "recipientCount", type: "uint256", indexed: false },
      { name: "totalDistributed", type: "uint256", indexed: false },
      { name: "feeCharged", type: "uint256", indexed: false },
    ],
  },
] as const;
