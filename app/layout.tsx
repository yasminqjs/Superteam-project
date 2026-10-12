import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { MockBanner } from "@/components/mock-banner";
import { SessionProvider } from "@/components/providers/session-provider";
import { SolanaProvider } from "@/components/providers/solana-provider";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Recebi: stablecoin receivables for Brazilian companies, with proof",
  description:
    "The receivables back office for Brazilian companies and freelancers who sell services abroad. Each stablecoin payment arrives tied to its invoice, valued in BRL at the Central Bank's official PTAX rate, and backed by a receipt anyone can verify onchain.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SolanaProvider>
          <SessionProvider>
            <MockBanner />
            {children}
          </SessionProvider>
        </SolanaProvider>
      </body>
    </html>
  );
}
