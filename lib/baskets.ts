/**
 * Themed baskets people rotate between. Every stock here had real USDC liquidity on Base when picked
 * (onchain scan of all 415 Coinbase tokenized stocks, 2026-11-25). Re-check with `npm run check-universe`.
 * Weights are basis points and must sum to 10000.
 */
export type Leg = { symbol: string; weightBps: number };
export type Basket = {
  id: string;
  name: string;
  /** One line, CT tone. */
  thesis: string;
  /** Base palette accent for cards and charts. */
  color: string;
  /** Text color on top of `color`. */
  ink: string;
  legs: Leg[];
};

/** The 14 stocks the app trades. Anything outside this list is shown on the radar but not bought. */
export const UNIVERSE = [
  "NVDAc", "AAPLc", "MSFTc", "GOOGLc", "AMZNc", "METAc", "TSLAc",
  "PLTRc", "AMDc", "SPCXc", "ANTc", "MSTRc", "HOODc", "CRCLc",
] as const;

const even = (symbols: string[]): Leg[] => {
  const base = Math.floor(10_000 / symbols.length);
  return symbols.map((symbol, i) => ({
    symbol,
    weightBps: i === symbols.length - 1 ? 10_000 - base * (symbols.length - 1) : base,
  }));
};

export const BASKETS: Basket[] = [
  {
    id: "mag7",
    name: "Mag 7",
    thesis: "The seven names that carry the S&P. Boring, until it isn't.",
    color: "#0000FF",
    ink: "#FFFFFF",
    legs: even(["AAPLc", "MSFTc", "GOOGLc", "AMZNc", "METAc", "NVDAc", "TSLAc"]),
  },
  {
    id: "ai-bubble",
    name: "AI Bubble",
    thesis: "Chips, models and the data layer. Ride it or fade it.",
    color: "#3C8AFF",
    ink: "#FFFFFF",
    legs: even(["NVDAc", "AMDc", "PLTRc", "MSFTc"]),
  },
  {
    id: "pre-ipo",
    name: "Pre-IPO",
    thesis: "Anthropic and SpaceX before the bell. Normally VC-only.",
    color: "#0A0B0D",
    ink: "#FFFFFF",
    legs: even(["ANTc", "SPCXc"]),
  },
  {
    id: "elon-mode",
    name: "Elon Mode",
    thesis: "Cars, rockets, satellites. One guy's whole bag.",
    color: "#FC401F",
    ink: "#FFFFFF",
    legs: [
      { symbol: "TSLAc", weightBps: 6000 },
      { symbol: "SPCXc", weightBps: 4000 },
    ],
  },
  {
    id: "crypto-bros",
    name: "Crypto Bros",
    thesis: "The stocks that pump when BTC does. Saylor, Vlad and the stablecoin guys.",
    color: "#FFD12F",
    ink: "#0A0B0D",
    legs: [
      { symbol: "MSTRc", weightBps: 3400 },
      { symbol: "HOODc", weightBps: 3300 },
      { symbol: "CRCLc", weightBps: 3300 },
    ],
  },
];

export const DEFAULT_BASKET_ID = process.env.NEXT_PUBLIC_DEFAULT_BASKET ?? "mag7";

export function getBasket(id?: string | null): Basket {
  const b = BASKETS.find((x) => x.id === id) ?? BASKETS.find((x) => x.id === DEFAULT_BASKET_ID) ?? BASKETS[0];
  const total = b.legs.reduce((s, l) => s + l.weightBps, 0);
  if (total !== 10_000) throw new Error(`Basket ${b.id} weights sum to ${total}, not 10000`);
  return b;
}

export const BASKET_IDS = BASKETS.map((b) => b.id) as [string, ...string[]];
