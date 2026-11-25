/** Dev only: serves the compiled LoanGuard creation code from build/ to the /deploy-guard page. */
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: "not_found" }, { status: 404 });
  try {
    const bin = (await readFile("build/contracts_LoanGuard_sol_LoanGuard.bin", "utf8")).trim();
    return NextResponse.json({ bytecode: `0x${bin}` });
  } catch {
    return NextResponse.json({ error: "Run npm run guard:build first" }, { status: 400 });
  }
}
