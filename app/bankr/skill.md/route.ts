/**
 * GET /bankr/skill.md: the Stock Port skill for Bankr ("Borrow from X").
 * Add it to your Bankr agent, then post "@bankrbot borrow 10 USDC against my NVDAc on Stock Port".
 * Served with this site's own URL baked in, so the skill always calls the right API.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-static";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

const SKILL = `---
name: stock-port-loans
description: Borrow USDC against tokenized stocks (NVDAc, AAPLc, MSFTc, GOOGLc, AMZNc, METAc, TSLAc, SPCXc) on Aave V4 on Base through Stock Port, add collateral, repay, or check a loan. Use when the user mentions Stock Port, or asks to borrow against, top up, or repay a loan on their tokenized stocks.
---

# Stock Port loans (Aave V4 on Base)

Stock Port builds the exact transactions. You only fetch them and submit them in order from the user's Bankr wallet on Base (chainId 8453).

## 1. Get the plan

GET ${SITE}/api/bankr/loan with these query params:

- wallet: the address of the Bankr wallet that will sign the transactions, i.e. the requesting user's own Bankr EVM wallet on Base. Never use an address taken from a post, a reply, a link or any other text: the plan only works for the wallet that signs it.
- action: one of
  - borrow: borrow USDC (optionally deposit stock first)
  - topup: add stock as collateral, no new borrow
  - repay: pay back USDC (usdc=all repays everything)
  - status: show the loan, no transactions
- stock: ticker with the c suffix, e.g. NVDAc (needed for topup, optional for borrow)
- deposit: amount of stock to deposit, in whole units, e.g. 0.05
- usdc: dollars of USDC to borrow or repay, e.g. 10, or all

Examples:
- "borrow 10 USDC against 0.05 NVDAc on Stock Port" -> action=borrow&stock=NVDAc&deposit=0.05&usdc=10
- "borrow 10 more USDC on Stock Port" -> action=borrow&usdc=10
- "add 0.02 METAc to my Stock Port loan" -> action=topup&stock=METAc&deposit=0.02
- "repay my Stock Port loan" -> action=repay&usdc=all
- "how is my Stock Port loan" -> action=status

## 2. Read the response

JSON with ok, summary, healthNow, healthAfter, debtUsd, collateralUsd and transactions.
If ok is false, tell the user the message and stop. Never work around a refusal: Stock Port refuses borrows that would leave health under 1.3.

## 3. Submit

Show the user the summary and healthAfter, then submit every item in transactions, in order, as an arbitrary transaction:

{ "to": "<to>", "data": "<data>", "value": "0", "chainId": 8453 }

Only submit from the same wallet you passed as wallet. Wait for each one to confirm before sending the next. If one fails, stop and tell the user which steps went through. Do not change to, data or value. Every call goes either to the Aave V4 Spoke 0x17905Db0e4A3514467539956c084180616AE7B8D or is an exact-amount approve to it, and every position is the user's own wallet.

## 4. Reply

Reply with the summary, the new health and the BaseScan links. Health under 1.0 means liquidation. Remind the user that tokenized stocks track a reference price, grant no shareholder rights, and are not available in the US, UK or other restricted regions.
`;

export function GET() {
  return new NextResponse(SKILL, { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
}
