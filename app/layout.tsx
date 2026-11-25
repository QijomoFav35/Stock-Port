import type { Metadata } from "next";
import { Cormorant_Garamond, IBM_Plex_Mono, Inter, Montserrat } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

/** Body and small UI text: tighter and easier to read than Montserrat at 13–15px. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

/** Wordmark only: one weight, latin subset, not preloaded so it never blocks the first paint. */
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["600"],
  preload: false,
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Stock Port · Your port of entry to Tokenized Stocks",
  description: "Buy, borrow, rotate and sweep tokenized stocks on Base from one terminal. Every move in one tx. Self-custody.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${montserrat.variable} ${inter.variable} ${cormorant.variable} ${plexMono.variable}`}>
        <Providers>
          <Navbar />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
