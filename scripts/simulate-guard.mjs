#!/usr/bin/env node
/**
 * Dry-run LoanGuard against live Base mainnet state, without deploying or spending anything.
 *
 *   npm run guard:build   # compiles contracts/LoanGuard.sol with solc 0.8.24 into build/
 *   npm run guard:sim     # simulates deploy + setup + protect() with eth_simulateV1
 *
 * It borrows a real Aave V4 borrower's position (read-only, simulated), gives them a test USDC
 * reserve via a state override, sets their trigger above their current health, and checks that
 * protect() repays just enough to reach the target and charges only their reserve.
 * Uses BASE_RPC_URL or NEXT_PUBLIC_BASE_RPC_URL if set (needs eth_simulateV1), else mainnet.base.org.
 */
import { readFileSync } from "node:fs";
import { encodeFunctionData, decodeFunctionResult, getContractAddress, keccak256, encodeAbiParameters, pad, toHex, formatUnits } from "viem";

const RPC = process.env.BASE_RPC_URL || process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
const SPOKE = "0x17905Db0e4A3514467539956c084180616AE7B8D";
const GIVER = "0x9E81c2fDE4E34CAB3AB1667ca3c932dBAED95F08";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USER = process.argv[2] || "0x9e3787f9f7f0fF7Eea9e36628BecA431B61AE647"; // a live borrower with NVDAc collateral
const DEPLOYER = "0x00000000000000000000000000000000000d3910";
const KEEPER = "0x0000000000000000000000000000000000000Bee";

const bin = "0x" + readFileSync("build/contracts_LoanGuard_sol_LoanGuard.bin", "utf8").trim();
const abi = JSON.parse(readFileSync("build/contracts_LoanGuard_sol_LoanGuard.abi", "utf8"));
const GUARD = getContractAddress({ from: DEPLOYER, nonce: 0n });

const erc20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
];
const spoke = [
  { type: "function", name: "setUserPositionManager", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "bool" }], outputs: [] },
  {
    type: "function",
    name: "getUserAccountData",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: Array.from({ length: 7 }, () => ({ type: "uint256" })),
  },
];

async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

const acct = async () => {
  const r = await rpc("eth_call", [{ to: SPOKE, data: encodeFunctionData({ abi: spoke, functionName: "getUserAccountData", args: [USER] }) }, "latest"]);
  return decodeFunctionResult({ abi: spoke, functionName: "getUserAccountData", data: r });
};

const before = await acct();
const hf = Number(before[2]) / 1e18;
if (before[4] === 0n) throw new Error("That address has no USDC debt on the Spoke. Pass a borrower address.");
const trigger = BigInt(Math.round((hf + 0.2) * 1e4)) * 10n ** 14n;
const target = trigger + 10n ** 17n; // +0.10
console.log(`User ${USER}: health ${hf.toFixed(4)}. Simulating trigger ${Number(trigger) / 1e18}, target ${Number(target) / 1e18}.`);

// Give the user a test USDC balance (FiatToken balance mapping is slot 9).
const balSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [USER, 9n]));
const RESERVE = 10n ** 13n; // 10M USDC, plenty

const call = (from, to, a, functionName, args) => ({ from, to, data: encodeFunctionData({ abi: a, functionName, args }) });
const calls = [
  { from: DEPLOYER, data: bin },
  call(USER, SPOKE, spoke, "setUserPositionManager", [GIVER, true]),
  call(USER, GUARD, abi, "configure", [trigger, target, 0n]),
  call(USER, USDC, erc20, "approve", [GUARD, RESERVE]),
  call(USER, GUARD, abi, "fund", [RESERVE]),
  call(KEEPER, GUARD, abi, "check", [USER]),
  call(KEEPER, GUARD, abi, "protect", [USER]),
  call(KEEPER, SPOKE, spoke, "getUserAccountData", [USER]),
  call(KEEPER, GUARD, abi, "guards", [USER]),
  call(KEEPER, GUARD, abi, "protect", [USER]), // second call must revert: user is healthy again
];

const [block] = await rpc("eth_simulateV1", [
  { blockStateCalls: [{ stateOverrides: { [USDC]: { stateDiff: { [balSlot]: pad(toHex(RESERVE)) } } }, calls }], validation: false },
  "latest",
]);
const r = block.calls;
const ok = (i) => r[i].status === "0x1";
const names = ["deploy", "approve Giver", "configure", "approve USDC", "fund", "check", "protect", "account after", "guard state", "protect again"];
r.forEach((c, i) => console.log(`${ok(i) ? "ok " : "REV"} ${names[i]}${c.error ? `  (${c.error.message})` : ""}`));

const chk = decodeFunctionResult({ abi, functionName: "check", data: r[5].returnData });
const repaid = decodeFunctionResult({ abi, functionName: "protect", data: r[6].returnData });
const after = decodeFunctionResult({ abi: spoke, functionName: "getUserAccountData", data: r[7].returnData });
const g = decodeFunctionResult({ abi, functionName: "guards", data: r[8].returnData });
console.log(`check(): needed=${chk[0]} amount=${formatUnits(chk[3], 6)} USDC`);
console.log(`protect(): repaid ${formatUnits(repaid, 6)} USDC`);
console.log(`health ${hf.toFixed(4)} -> ${(Number(after[2]) / 1e18).toFixed(4)} (target ${Number(target) / 1e18})`);
console.log(`reserve left ${formatUnits(g[0], 6)} USDC (charged ${formatUnits(RESERVE - g[0], 6)})`);

const pass =
  [0, 1, 2, 3, 4, 5, 6, 7, 8].every(ok) &&
  !ok(9) &&
  chk[0] === true &&
  RESERVE - g[0] === repaid &&
  Number(after[2]) / 1e18 >= Number(target) / 1e18 - 0.01;
console.log(pass ? "\nPASS: guard repaid to target, charged only the reserve, and refused to act once healthy." : "\nFAIL: see the lines above.");
process.exit(pass ? 0 : 1);
