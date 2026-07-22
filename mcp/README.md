# Solar Ranch MCP server

The ranch, agent-readable. Read-only MCP tools over stdio so any MCP client
(Claude Desktop/Code, ChatGPT, Cursor, …) can verify the Herd straight from
Robinhood Chain — no keys, no transactions, no wallet.

## Tools

| Tool | What it does |
|---|---|
| `get_herd_status` | Every node's state from the Proof of Sunlight contract |
| `get_telemetry` | Recent signed epochs for a node (watts, battery, MB, tx hash) |
| `check_access` | Read-only $RANCH `balanceOf` vs the access threshold |

Before the contracts deploy, every tool answers with an honest "pre-launch"
message instead of fake data — same policy as the website.

## Setup

```sh
cd mcp && npm install
```

Client config (e.g. Claude Desktop `mcpServers`, or `claude mcp add`):

```json
{
  "solar-ranch": {
    "command": "node",
    "args": ["/path/to/solar-ranch/mcp/server.js"],
    "env": {
      "POS_ADDRESS": "0x…",
      "RANCH_ADDRESS": "0x…",
      "NODE_ADDRESSES": "0x…:LONGHORN-01"
    }
  }
}
```

`RPC_URL` defaults to `https://rpc.mainnet.chain.robinhood.com` (chain 4663);
`RANCH_THRESHOLD` defaults to `1000000` whole tokens.
