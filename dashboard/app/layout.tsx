import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "RWAForge — Agent-Powered RWA Rewards Infrastructure",
  description: "Distribute tokenized stocks and RWAs on Robinhood Chain. Powered by agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-navy text-slate-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
