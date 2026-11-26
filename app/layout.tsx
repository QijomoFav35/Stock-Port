import type { Metadata } from "next";
import { Cormorant_Garamond, IBM_Plex_Mono, Inter, Montserrat } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Analytics from "@/components/Analytics";

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

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const TITLE = "Stock Port · Your port of entry to Tokenized Stocks";
const DESCRIPTION = "Buy, borrow, rotate and sweep tokenized stocks on Base from one terminal. Every move in one tx. Self-custody.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Stock Port",
  keywords: ["tokenized stocks", "Base", "onchain stocks", "borrow against stocks", "Aave V4", "RWA", "NVDAc", "TSLAc"],
  openGraph: {
    type: "website",
    siteName: "Stock Port",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/share/image", width: 1200, height: 630, alt: "Stock Port" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/share/image"] },
  robots: { index: true, follow: true },
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
        <Analytics />
      </body>
    </html>
  );
}
