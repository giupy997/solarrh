#!/usr/bin/env node
// Solar Ranch node agent — reads power telemetry and posts Proof of Sunlight
// epochs to Robinhood Chain. Runs on the node itself (Raspberry Pi class).
//
// Modes:
//   SENSOR=sim   clear-sky solar model (bench testing, no hardware)
//   SENSOR=ina226  real INA226 power monitor over I2C (on the Pi)
//
// Usage:
//   RPC_URL=... POS_ADDRESS=0x... NODE_KEY_FILE=~/.solar-ranch/node.key node agent.js --once
//   ... same without --once → loops every EPOCH_INTERVAL (default 600s)
//
// The node key is generated on first run and NEVER leaves the device.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
const { ethers } = require("ethers");

// ---------- config ----------

const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const POS_ADDRESS = process.env.POS_ADDRESS || "";
const SENSOR = process.env.SENSOR || "sim";
const EPOCH_INTERVAL = parseInt(process.env.EPOCH_INTERVAL || "600", 10); // seconds
const KEY_FILE = process.env.NODE_KEY_FILE || path.join(os.homedir(), ".solar-ranch", "node.key");
const WG_INTERFACE = process.env.WG_INTERFACE || "wg0";
const ONCE = process.argv.includes("--once");
const DRY_RUN = process.argv.includes("--dry-run");

const POS_ABI = [
  "function postEpoch(uint32 solarDw, uint8 batteryPct, uint32 servedMb, uint32 uptimeS)",
  "function latest(address) view returns (string name, bool active, uint64 epochCount, uint64 lastPostedAt, uint32 solarDw, uint8 batteryPct, uint32 servedMb, uint32 uptimeS)",
];

// ---------- node identity ----------

function loadOrCreateKey() {
  if (fs.existsSync(KEY_FILE)) {
    return new ethers.Wallet(fs.readFileSync(KEY_FILE, "utf8").trim());
  }
  const wallet = ethers.Wallet.createRandom();
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(KEY_FILE, wallet.privateKey + "\n", { mode: 0o600 });
  console.log(`[agent] generated new node key -> ${KEY_FILE}`);
  console.log(`[agent] node address: ${wallet.address}`);
  console.log(`[agent] register it with: cast send <POS> "registerNode(address,string)" ${wallet.address} "LONGHORN-01" ...`);
  return wallet;
}

// ---------- sensors ----------

function simSensor() {
  // Clear-sky model: sunrise 06:00, peak 13:00, sunset 21:00, 200 W panel.
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  let w = 0;
  if (h >= 6 && h <= 21) {
    const t = (h - 6) / 15;
    w = 200 * 0.92 * Math.pow(Math.sin(Math.PI * t), 1.35);
    w *= 1 + (Math.random() - 0.5) * 0.08; // light noise
  }
  return {
    solarDw: Math.max(0, Math.round(w * 10)),
    batteryPct: Math.min(100, 60 + Math.round((w / 200) * 35)),
  };
}

function ina226Sensor() {
  // INA226 @ 0x40 on i2c-1: bus voltage reg 0x02 (1.25 mV/LSB),
  // current via shunt reg 0x01 (2.5 uV/LSB across R_SHUNT ohms).
  const I2C_BUS = parseInt(process.env.I2C_BUS || "1", 10);
  const I2C_ADDR = parseInt(process.env.I2C_ADDR || "0x40", 16);
  const R_SHUNT = parseFloat(process.env.R_SHUNT || "0.002");
  const i2c = require("i2c-bus"); // npm install i2c-bus (on the Pi only)
  const bus = i2c.openSync(I2C_BUS);
  const swap = (v) => ((v & 0xff) << 8) | (v >> 8);
  const busRaw = swap(bus.readWordSync(I2C_ADDR, 0x02));
  const shuntRaw = swap(bus.readWordSync(I2C_ADDR, 0x01));
  bus.closeSync();
  const volts = busRaw * 0.00125;
  const shuntV = (shuntRaw > 0x7fff ? shuntRaw - 0x10000 : shuntRaw) * 0.0000025;
  const amps = shuntV / R_SHUNT;
  const watts = Math.max(0, volts * amps);
  // LiFePO4 12.8 V nominal: crude SoC from voltage (13.6 full / 12.0 empty)
  const batteryPct = Math.max(0, Math.min(100, Math.round(((volts - 12.0) / 1.6) * 100)));
  return { solarDw: Math.round(watts * 10), batteryPct };
}

function readSensor() {
  return SENSOR === "ina226" ? ina226Sensor() : simSensor();
}

// ---------- served bytes (WireGuard) ----------

let lastWgBytes = null;
function servedMbSinceLastEpoch() {
  try {
    const out = execSync(`wg show ${WG_INTERFACE} transfer`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    // lines: <peer-pubkey>\t<rx bytes>\t<tx bytes>
    let total = 0;
    for (const line of out.trim().split("\n")) {
      const parts = line.split("\t");
      if (parts.length === 3) total += parseInt(parts[1], 10) + parseInt(parts[2], 10);
    }
    const delta = lastWgBytes === null ? 0 : Math.max(0, total - lastWgBytes);
    lastWgBytes = total;
    return Math.round(delta / 1e6);
  } catch {
    // no WireGuard on this box (bench mode): report 0, honestly
    return 0;
  }
}

// ---------- main loop ----------

async function postOnce(contract, wallet) {
  const { solarDw, batteryPct } = readSensor();
  const servedMb = servedMbSinceLastEpoch();
  const uptimeS = Math.min(EPOCH_INTERVAL, Math.round(os.uptime()));
  const line = `solar=${(solarDw / 10).toFixed(1)}W battery=${batteryPct}% served=${servedMb}MB uptime=${uptimeS}s`;

  if (DRY_RUN) {
    console.log(`[agent] DRY RUN — would post: ${line}`);
    return;
  }
  const tx = await contract.postEpoch(solarDw, batteryPct, servedMb, uptimeS);
  const rcpt = await tx.wait();
  console.log(`[agent] epoch posted: ${line} tx=${rcpt.hash} block=${rcpt.blockNumber}`);
}

async function main() {
  const wallet = loadOrCreateKey();
  console.log(`[agent] node address: ${wallet.address}`);
  console.log(`[agent] sensor=${SENSOR} rpc=${RPC_URL} pos=${POS_ADDRESS || "(unset)"} interval=${EPOCH_INTERVAL}s`);

  if (!POS_ADDRESS && !DRY_RUN) {
    console.error("[agent] POS_ADDRESS not set — running dry (use --dry-run to silence, or set POS_ADDRESS)");
    process.argv.push("--dry-run");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = wallet.connect(provider);
  const contract = POS_ADDRESS ? new ethers.Contract(POS_ADDRESS, POS_ABI, signer) : null;

  for (;;) {
    try {
      await postOnce(contract, wallet);
    } catch (e) {
      const msg = (e.shortMessage || e.message || "").slice(0, 200);
      console.error(`[agent] post failed: ${msg}`);
    }
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, EPOCH_INTERVAL * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
