#!/usr/bin/env node
// Solar Ranch MCP server — the ranch, agent-readable.
// Exposes read-only tools over stdio so any MCP client (Claude, ChatGPT, Cursor…)
// can verify the herd directly from Robinhood Chain: telemetry, access, status.
// No keys, no transactions — this server can only read.
//
// Usage (e.g. in an MCP client config):
//   command: node
//   args: ["/path/to/solar-ranch/mcp/server.js"]
//   env: RPC_URL, POS_ADDRESS, RANCH_ADDRESS, NODE_ADDRESSES ("0xabc:LONGHORN-01,0xdef:MAVERICK-02")

"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const POS_ADDRESS = process.env.POS_ADDRESS || "";
const RANCH_ADDRESS = process.env.RANCH_ADDRESS || "";
const RANCH_THRESHOLD = BigInt(process.env.RANCH_THRESHOLD || "1000000"); // whole tokens
const EXPLORER = "https://robinhoodchain.blockscout.com";

// "0xaddr:NAME,0xaddr:NAME" -> [{address, name}]
const NODES = (process.env.NODE_ADDRESSES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [address, name] = s.split(":");
    return { address, name: name || address };
  });

// Selectors / topics (precomputed from the ABIs)
const SEL_LATEST = "0x4a4aac1a";     // latest(address)
const SEL_BALANCE_OF = "0x70a08231"; // balanceOf(address)
const TOPIC_EPOCH = "0x6e95d77d28590bf98c4f4570baea8a19c40d52c69ed9baea175f20341eeb086b";

const pad32 = (addr) => "000000000000000000000000" + addr.toLowerCase().replace(/^0x/, "");
const word = (hex, i) => BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));

async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

async function latestFor(nodeAddress) {
  const res = await ethCall(POS_ADDRESS, SEL_LATEST + pad32(nodeAddress));
  return {
    epochCount: Number(word(res, 2)),
    lastPostedAt: Number(word(res, 3)),
    solarW: Number(word(res, 4)) / 10,
    batteryPct: Number(word(res, 5)),
    servedMb: Number(word(res, 6)),
    uptimeS: Number(word(res, 7)),
    active: word(res, 1) === 1n,
  };
}

function notDeployed(what) {
  return {
    content: [{
      type: "text",
      text: `${what} is not deployed yet. Solar Ranch is pre-launch: the site runs a labeled simulation ` +
        `until LONGHORN-01 posts epoch #1 on Robinhood Chain (id 4663). Watch ${EXPLORER} and ` +
        `https://github.com/giupy997/solarrh for the deployment.`,
    }],
  };
}

const server = new McpServer({ name: "solar-ranch", version: "0.1.0" });

server.registerTool(
  "get_herd_status",
  {
    title: "Herd status",
    description:
      "Status of every Solar Ranch node (the Herd) from the Proof of Sunlight contract on Robinhood Chain: " +
      "active flag, epochs posted, last reading. Read-only.",
    inputSchema: {},
  },
  async () => {
    if (!POS_ADDRESS) return notDeployed("The Proof of Sunlight contract");
    if (!NODES.length) return notDeployed("No node is registered yet — the herd");
    const rows = [];
    for (const n of NODES) {
      const l = await latestFor(n.address);
      rows.push({ name: n.name, address: n.address, ...l });
    }
    return { content: [{ type: "text", text: JSON.stringify({ chainId: 4663, contract: POS_ADDRESS, nodes: rows }, null, 2) }] };
  }
);

server.registerTool(
  "get_telemetry",
  {
    title: "Node telemetry",
    description:
      "Recent Proof of Sunlight epochs for one node (default: the first registered). Each epoch is a signed " +
      "on-chain reading: solar watts, battery %, MB served, uptime. Verify any of it on Blockscout. Read-only.",
    inputSchema: {
      node_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional()
        .describe("Node key address; defaults to the first registered node"),
      max_epochs: z.number().int().min(1).max(144).default(24)
        .describe("How many recent epochs to return (default 24 = ~4 hours)"),
    },
  },
  async ({ node_address, max_epochs }) => {
    if (!POS_ADDRESS) return notDeployed("The Proof of Sunlight contract");
    const addr = node_address || (NODES[0] && NODES[0].address);
    if (!addr) return notDeployed("No node is registered yet — telemetry");
    const logs = await rpc("eth_getLogs", [{
      address: POS_ADDRESS,
      topics: [TOPIC_EPOCH, "0x" + pad32(addr)],
      fromBlock: "0x0",
      toBlock: "latest",
    }]);
    const epochs = logs.slice(-(max_epochs || 24)).map((log) => ({
      epoch: Number(BigInt(log.topics[2])),
      solarW: Number(word(log.data, 0)) / 10,
      batteryPct: Number(word(log.data, 1)),
      servedMb: Number(word(log.data, 2)),
      uptimeS: Number(word(log.data, 3)),
      timestamp: new Date(Number(word(log.data, 4)) * 1000).toISOString(),
      tx: log.transactionHash,
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ node: addr, count: epochs.length, explorer: EXPLORER, epochs }, null, 2),
      }],
    };
  }
);

server.registerTool(
  "check_access",
  {
    title: "Check $RANCH access",
    description:
      "Read-only $RANCH balance check for an address against the Herd access threshold. Never signs anything; " +
      "this is the same check the website's no-wallet-connect bar runs.",
    inputSchema: {
      address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("EVM address to check"),
    },
  },
  async ({ address }) => {
    if (!RANCH_ADDRESS) return notDeployed("The $RANCH token");
    const res = await ethCall(RANCH_ADDRESS, SEL_BALANCE_OF + pad32(address));
    const whole = BigInt(res) / 10n ** 18n;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          address,
          balance: whole.toString(),
          threshold: RANCH_THRESHOLD.toString(),
          accessGranted: whole >= RANCH_THRESHOLD,
        }, null, 2),
      }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[solar-ranch mcp] up — rpc=${RPC_URL} pos=${POS_ADDRESS || "(unset)"} ranch=${RANCH_ADDRESS || "(unset)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
