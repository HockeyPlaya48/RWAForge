"use client";

import { useAccount, useBalance } from "wagmi";

const FAUCET_URL = "https://faucet.testnet.chain.robinhood.com/";

function StepIcon({ done }: { done: boolean }) {
  if (done) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-mint text-navy">
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  return <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 text-xs text-slate-500" />;
}

export function GetStarted() {
  const { address, isConnected } = useAccount();
  const { data: balance } = useBalance({ address, query: { enabled: Boolean(address) } });

  const hasGas = Boolean(balance && balance.value > 0n);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6">
      <h2 className="text-base font-semibold text-slate-100">How to test this</h2>
      <p className="mt-1 text-sm text-slate-500">
        Everything here runs on Robinhood Chain Testnet — no real value, free to try.
      </p>

      <ol className="mt-5 space-y-4">
        <li className="flex items-start gap-3">
          <StepIcon done={isConnected} />
          <div>
            <p className="text-sm font-medium text-slate-200">Connect your wallet</p>
            <p className="text-xs text-slate-500">Use the button top right. Any injected wallet works (MetaMask, etc.).</p>
          </div>
        </li>
        <li className="flex items-start gap-3">
          <StepIcon done={hasGas} />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-200">Get testnet ETH</p>
            <p className="text-xs text-slate-500">
              {hasGas
                ? `You have ${Number(balance!.formatted).toFixed(4)} ETH — enough for gas.`
                : "Needed to pay gas for any transaction. Free from the official faucet."}
            </p>
            {!hasGas && (
              <a
                href={FAUCET_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-mint px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:bg-mint-bright"
              >
                Get Testnet ETH
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M7 7h10v10" />
                </svg>
              </a>
            )}
          </div>
        </li>
        <li className="flex items-start gap-3">
          <StepIcon done={false} />
          <div>
            <p className="text-sm font-medium text-slate-200">Try it</p>
            <p className="text-xs text-slate-500">
              Check <span className="text-slate-300">My Rewards</span> to see what's claimable to your address. Nothing
              there yet? Use <span className="text-slate-300">Operator Tools</span> to distribute your own test token to any
              address — that part works for anyone with gas, right now.
            </p>
          </div>
        </li>
      </ol>
    </div>
  );
}
