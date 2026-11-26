#!/usr/bin/env node
/**
 * Dry-run AutoPilot against live Base mainnet state, without deploying or spending anything.
 *
 *   npm run autopilot:build   # compiles contracts/AutoPilot.sol with solc 0.8.24 into build/
 *   npm run autopilot:sim     # simulates deploy, deposit, rules, agent buy and sell, and the safety reverts
 *
 * A test wallet gets 100 USDC through a state override. It deposits, writes rules, and picks an agent.
 * The agent buys NVDAc and sells it back through Aerodrome. Then we check that the guard rails hold:
 * the agent can't use another pool or buy and sell the same stock, a stranger can't rebalance, the interval rule
 * blocks a second trade, rules need at least a day between trades, and exit() returns everything.
 */
import { readFileSync } from "node:fs";
import { encodeFunctionData, decodeFunctionResult, getContractAddress, getAddress, keccak256, encodeAbiParameters, pad, toHex, formatUnits } from "viem";

const A = (x) => getAddress(x.toLowerCase());
const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const USDC = A("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const USER = A("0x00000000000000000000000000000000000A11CE");
const AGENT = A("0x0000000000000000000000000000000000000Bee");
const STRANGER = A("0x000000000000000000000000000000000000BAD0");
const DEPLOYER = A("0x00000000000000000000000000000000000d3910");

const RAW_STOCKS = [
  ["NVDAc", "0xb20000000000000000000078ee7ce2fE4908108C", "0x04689a41629776563E6822F76f2e57D148d28513"],
  ["GOOGLc", "0xb2000000000000000000002D0BA3164cc74f58B7", "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2"],
  ["METAc", "0xb2000000000000000000008bC8786B856E61707C", "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D"],
  ["AAPLc", "0xb200000000000000000000C2e324d24d7eEcd1fb", "0x787f13dEa48Db0897CbCDD985de77809D837F988"],
  ["MSFTc", "0xB200000000000000000000Ab99cFa739E253872B", "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c"],
  ["TSLAc", "0xb2000000000000000000001e800a7f5189430cD0", "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4"],
  ["AMZNc", "0xb200000000000000000000d9192b6B456483C2E8", "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295"],
];
const STOCKS = RAW_STOCKS.map(([s, t, f]) => [s, A(t), A(f)]);
const NVDA = STOCKS[0][1];

const bin = readFileSync("build/contracts_AutoPilot_sol_AutoPilot.bin", "utf8").trim();
const abi = JSON.parse(readFileSync("build/contracts_AutoPilot_sol_AutoPilot.abi", "utf8"));
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

const ethCall = async (to, a, functionName, args = []) =>
  decodeFunctionResult({ abi: a, functionName, data: await rpc("eth_call", [{ to, data: encodeFunctionData({ abi: a, functionName, args }) }, "latest"]) });
const ROUTER = "0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F";
const routerAbi = [{ type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }];
const factoryAbi = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "int24" }], outputs: [{ type: "address" }] },
];
const balAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }];

// Pin each stock to the router-factory USDC pool holding the most USDC (the deploy page does the same, plus a NAV check).
const factory = await ethCall(ROUTER, routerAbi, "factory");
const TICKS = [];
for (const [sym, token] of STOCKS) {
  let best = { ts: undefined, usdc: -1n };
  for (const ts of [1, 10, 50, 100, 200, 2000]) {
    const pool = await ethCall(factory, factoryAbi, "getPool", [USDC, token, ts]);
    if (/^0x0{40}$/i.test(pool)) continue;
    const usdc = await ethCall(USDC, balAbi, "balanceOf", [pool]);
    if (usdc > best.usdc) best = { ts, usdc };
  }
  if (best.ts === undefined) throw new Error(`No USDC pool for ${sym}`);
  TICKS.push(best.ts);
}
const tick = TICKS[0];
const deployData =
  "0x" +
  bin +
  encodeAbiParameters([{ type: "address[]" }, { type: "address[]" }, { type: "int24[]" }], [STOCKS.map((s) => s[1]), STOCKS.map((s) => s[2]), TICKS]).slice(2);

// Same window as the contract: closed Fri 20:00 UTC to Mon 01:00 UTC and on NYSE holidays. Simulate at the next open hour.
const HOLIDAYS = new Set([20783, 20812, 20819, 20836, 20864, 20903, 20969, 20987, 21004, 21067, 21147, 21176]);
const closed = (ts) => {
  const d = Math.floor(ts / 86400), day = (d + 4) % 7, h = Math.floor((ts % 86400) / 3600);
  if ((day === 5 && h >= 20) || day === 6 || day === 0 || (day === 1 && h < 1)) return true;
  return HOLIDAYS.has(d) || (h < 1 && HOLIDAYS.has(d - 1));
};
const head = Number(BigInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp));
let at = head + 60;
while (closed(at)) at += 3600;

async function simulate(calls, time = at) {
  const [block] = await rpc("eth_simulateV1", [{ blockStateCalls: [{ blockOverrides: { time: toHex(time) }, stateOverrides: overrides, calls }], validation: false }, "latest"]);
  return block.calls;
}
if (closed(head)) console.log(`Markets are closed now, so the trades are simulated at ${new Date(at * 1000).toISOString()}.`);

const DAY = 86400;
const setup = [
  { from: DEPLOYER, data: deployData },
  call(USER, USDC, erc20, "approve", [AP, DEPOSIT]),
  call(USER, AP, abi, "deposit", [USDC, DEPOSIT]),
  call(USER, AP, abi, "setPilot", rules(DAY)),
];
const wrongTick = [1, 10, 50, 100, 200, 2000].find((t) => t !== tick);
const steps = [
  ["deploy", setup[0]],
  ["approve USDC", setup[1]],
  ["deposit 100 USDC", setup[2]],
  ["set rules + agent (1-day interval)", setup[3]],
  ["agent uses a different pool (must revert)", call(AGENT, AP, abi, "rebalance", [USER, [{ tokenIn: USDC, tokenOut: NVDA, amountIn: BUY, tickSpacing: wrongTick }]])],
  [
    "agent buys and sells the same stock (must revert)",
    call(AGENT, AP, abi, "rebalance", [USER, [{ tokenIn: USDC, tokenOut: NVDA, amountIn: BUY, tickSpacing: tick }, { tokenIn: NVDA, tokenOut: USDC, amountIn: 1n, tickSpacing: tick }]]),
  ],
  ["stranger tries to rebalance (must revert)", call(STRANGER, AP, abi, "rebalance", [USER, [{ tokenIn: USDC, tokenOut: NVDA, amountIn: 1n, tickSpacing: tick }]])],
  ["agent buys 50 USDC of NVDAc", call(AGENT, AP, abi, "rebalance", [USER, [{ tokenIn: USDC, tokenOut: NVDA, amountIn: BUY, tickSpacing: tick }]])],
  ["NVDAc balance", call(AGENT, AP, abi, "balances", [USER, NVDA])],
  ["agent trades again too soon (must revert)", call(AGENT, AP, abi, "rebalance", [USER, [{ tokenIn: USDC, tokenOut: NVDA, amountIn: 1n, tickSpacing: tick }]])],
  ["rules with only 1 hour between trades (must revert)", call(USER, AP, abi, "setPilot", rules(3600))],
  ["user exits", call(USER, AP, abi, "exit", [])],
  ["USDC left inside", call(AGENT, AP, abi, "balances", [USER, USDC])],
  ["NVDAc left inside", call(AGENT, AP, abi, "balances", [USER, NVDA])],
];
const r = await simulate(steps.map((s) => s[1]));
const ok = (i) => r[i].status === "0x1";
steps.forEach(([name], i) => console.log(`${ok(i) ? "ok " : "REV"} ${name}${r[i].error ? `  (${r[i].error.message})` : ""}`));

const nvda = decodeFunctionResult({ abi, functionName: "balances", data: r[8].returnData });
const left = decodeFunctionResult({ abi, functionName: "balances", data: r[12].returnData });
const leftNvda = decodeFunctionResult({ abi, functionName: "balances", data: r[13].returnData });
console.log(`\nPinned pools (tick spacing): ${STOCKS.map((s, i) => `${s[0]} ${TICKS[i]}`).join(", ")}.\nBought ${formatUnits(nvda, 8)} NVDAc for 50 USDC. After exit, left inside: ${formatUnits(left, 6)} USDC, ${formatUnits(leftNvda, 8)} NVDAc.`);

const pass = [0, 1, 2, 3, 7, 8, 11, 12, 13].every(ok) && [4, 5, 6, 9, 10].every((i) => !ok(i)) && nvda > 0n && left === 0n && leftNvda === 0n;
console.log(pass ? "\nPASS: agent traded within the rules; other pools, round trips, strangers, early trades and short intervals were refused; exit returned everything." : "\nFAIL: see the lines above.");
process.exit(pass ? 0 : 1);
