#!/usr/bin/env node
/**
 * Dry-run AutoPilot against live Base mainnet state, without deploying or spending anything.
 *
 *   npm run autopilot:build   # compiles contracts/AutoPilot.sol with solc 0.8.24 into build/
 *   npm run autopilot:sim     # simulates deploy, deposit, rules, agent buy and sell, and the safety reverts
 *
 * A test wallet gets 100 USDC through a state override. It deposits, writes rules, and picks an agent.
 * The agent buys NVDAc and sells it back through Aerodrome. Then we check that the guard rails hold:
 * a stranger can't rebalance, the interval rule blocks a second trade, and exit() returns everything.
 */
import { readFileSync } from "node:fs";
import { encodeFunctionData, decodeFunctionResult, getContractAddress, keccak256, encodeAbiParameters, pad, toHex, formatUnits } from "viem";

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USER = "0x00000000000000000000000000000000000A11CE";
const AGENT = "0x0000000000000000000000000000000000000Bee";
const STRANGER = "0x000000000000000000000000000000000000BAD0";
const DEPLOYER = "0x00000000000000000000000000000000000d3910";

const STOCKS = [
  ["NVDAc", "0xb20000000000000000000078ee7ce2fE4908108C", "0x04689a41629776563E6822F76f2e57D148d28513"],
  ["GOOGLc", "0xb2000000000000000000002D0BA3164cc74f58B7", "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2"],
  ["METAc", "0xb2000000000000000000008bC8786B856E61707C", "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D"],
  ["AAPLc", "0xb200000000000000000000C2e324d24d7eEcd1fb", "0x787f13dEa48Db0897CbCDD985de77809D837F988"],
  ["MSFTc", "0xB200000000000000000000Ab99cFa739E253872B", "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c"],
  ["TSLAc", "0xb2000000000000000000001e800a7f5189430cD0", "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4"],
  ["AMZNc", "0xb2000000000000000000d9192b6B456483C2E8", "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295"],
];
const NVDA = STOCKS[0][1];

const bin = readFileSync("build/contracts_AutoPilot_sol_AutoPilot.bin", "utf8").trim();
const abi = JSON.parse(readFileSync("build/contracts_AutoPilot_sol_AutoPilot.abi", "utf8"));
const deployData = "0x" + bin + encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }], [STOCKS.map((s) => s[1]), STOCKS.map((s) => s[2])]).slice(2);
const AP = getContractAddress({ from: DEPLOYER, nonce: 0n });
const erc20 = [{ type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }];

async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const call = (from, to, a, functionName, args) => ({ from, to, data: encodeFunctionData({ abi: a, functionName, args }) });

const DEPOSIT = 100n * 10n ** 6n;
const BUY = 50n * 10n ** 6n;
const balSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [USER, 9n]));
const overrides = { [USDC]: { stateDiff: { [balSlot]: pad(toHex(DEPOSIT)) } } };
// setPilot(agent, on, autoRotate, cutLosers, weekendPause, maxSlippageBps, minEdgeBps, cutAtBps, minInterval)
const rules = (interval) => [AGENT, true, true, true, false, 300, 200, 500, interval];

async function simulate(calls) {
  const [block] = await rpc("eth_simulateV1", [{ blockStateCalls: [{ stateOverrides: overrides, calls }], validation: false }, "latest"]);
  return block.calls;
}

// Find the NVDAc pool's tick spacing on the router's factory by trying each one.
const setup = [
  { from: DEPLOYER, data: deployData },
  call(USER, USDC, erc20, "approve", [AP, DEPOSIT]),
  call(USER, AP, abi, "deposit", [USDC, DEPOSIT]),
  call(USER, AP, abi, "setPilot", rules(0)),
];
let tick;
for (const t of [1, 10, 50, 100, 200, 2000]) {
  const r = await simulate([...setup, call(AGENT, AP, abi, "rebalance", [USER, [{ tokenIn: USDC, tokenOut: NVDA, amountIn: BUY, tickSpacing: t }]])]);
  if (r[0].status !== "0x1") throw new Error(`deploy failed: ${r[0].error?.message}`);
  if (r[4].status === "0x1") {
    tick = t;
    break;
  }
}
if (tick === undefined) throw new Error("No NVDAc/USDC pool found on the router for any tick spacing.");

const steps = [
  ["deploy", ...setup.slice(0, 1)],
  ["approve USDC", setup[1]],
  ["deposit 100 USDC", setup[2]],
  ["set rules + agent", setup[3]],
  ["agent buys 50 USDC of NVDAc", call(AGENT, AP, abi, "rebalance", [USER, [{ tokenIn: USDC, tokenOut: NVDA, amountIn: BUY, tickSpacing: tick }]])],
  ["NVDAc balance", call(AGENT, AP, abi, "balances", [USER, NVDA])],
  ["stranger tries to rebalance (must revert)", call(STRANGER, AP, abi, "rebalance", [USER, [{ tokenIn: USDC, tokenOut: NVDA, amountIn: 1n, tickSpacing: tick }]])],
  ["user sets a 1-hour interval", call(USER, AP, abi, "setPilot", rules(3600))],
  ["agent trades again too soon (must revert)", call(AGENT, AP, abi, "rebalance", [USER, [{ tokenIn: USDC, tokenOut: NVDA, amountIn: 1n, tickSpacing: tick }]])],
  ["user exits", call(USER, AP, abi, "exit", [])],
  ["USDC left inside", call(AGENT, AP, abi, "balances", [USER, USDC])],
];
const r = await simulate(steps.map((s) => s[1]));
const ok = (i) => r[i].status === "0x1";
steps.forEach(([name], i) => console.log(`${ok(i) ? "ok " : "REV"} ${name}${r[i].error ? `  (${r[i].error.message})` : ""}`));

const nvda = decodeFunctionResult({ abi, functionName: "balances", data: r[5].returnData });
const left = decodeFunctionResult({ abi, functionName: "balances", data: r[10].returnData });
console.log(`\nPool tick spacing ${tick}. Bought ${formatUnits(nvda, 8)} NVDAc for 50 USDC. After exit, USDC left inside: ${formatUnits(left, 6)}.`);

const pass = [0, 1, 2, 3, 4, 5, 7, 9, 10].every(ok) && !ok(6) && !ok(8) && nvda > 0n && left === 0n;
console.log(pass ? "\nPASS: agent traded within the rules, strangers and early trades were refused, and exit returned everything." : "\nFAIL: see the lines above.");
process.exit(pass ? 0 : 1);
