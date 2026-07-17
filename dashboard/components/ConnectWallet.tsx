"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 py-1 pl-1 pr-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-mint/15 text-[10px] font-semibold text-mint">
          {address.slice(2, 4).toUpperCase()}
        </span>
        <span className="font-mono text-sm text-slate-300">
          {address.slice(0, 6)}...{address.slice(-4)}
        </span>
        <button
          onClick={() => disconnect()}
          className="ml-1 text-xs text-slate-500 transition-colors hover:text-red-400"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: connectors[0] })}
      disabled={isPending}
      className="rounded-lg bg-mint px-4 py-2 text-sm font-medium text-navy shadow-sm transition-colors hover:bg-mint-bright disabled:opacity-50"
    >
      {isPending ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
