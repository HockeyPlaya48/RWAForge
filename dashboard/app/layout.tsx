import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "RWAForge — Agent-Powered RWA Rewards Infrastructure",
  description: "Distribute tokenized stocks and RWAs on Robinhood Chain. Powered by agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${inter.variable}`}>
      <body className="min-h-screen bg-navy font-sans text-slate-100 antialiased">
        <div
          className="pointer-events-none fixed inset-0 bg-grid-pattern bg-[length:40px_40px] opacity-[0.04]"
          aria-hidden="true"
        />
        <div className="relative">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
