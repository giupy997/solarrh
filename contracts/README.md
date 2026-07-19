# Solar Ranch — contracts

## ProofOfSunlight.sol

Telemetry registry for the Herd. The owner registers node keys; each node posts a
signed reading ("epoch") at most every 5 minutes. History is in `Epoch` events
(indexed by node), the latest reading per node is readable in one call via
`latest(address)`.

Design choices:
- **The tx signature is the node's signature** — no extra crypto, `postEpoch()`
  only accepts registered `msg.sender`s. Spoofing a reading means stealing the
  node's key from the physical box.
- **Sanity caps on-chain**: battery ≤ 100%, solar ≤ 5 kW (`MAX_SOLAR_DW`), and a
  5-minute minimum interval. A compromised node can lie inside those bounds, but
  it can't flood or post absurdities.
- Retired nodes keep their history and can never be re-registered under a new name.

## Test

```sh
forge test
```

## Deploy on Robinhood Chain (run this yourself — needs your key)

Never paste your private key in a chat or a file that gets committed. Use an env
var in your own shell:

```sh
export RPC=https://rpc.mainnet.chain.robinhood.com
export PK=<your-deployer-private-key>   # stays in your shell only

forge create src/ProofOfSunlight.sol:ProofOfSunlight --rpc-url $RPC --private-key $PK
```

Then register LONGHORN-01's key (generate a fresh keypair ON the node, it never
leaves the device):

```sh
cast send <POS_CONTRACT_ADDRESS> "registerNode(address,string)" <NODE_ADDRESS> "LONGHORN-01" \
  --rpc-url $RPC --private-key $PK
```

The node itself will then post with its own key:

```sh
cast send <POS_CONTRACT_ADDRESS> "postEpoch(uint32,uint8,uint32,uint32)" 1426 83 1287 600 \
  --rpc-url $RPC --private-key $NODE_PK
```

(1426 deciwatts = 142.6 W. Fund the node address with a little ETH for gas —
at Robinhood Chain gas prices, cents cover months of 10-minute epochs.)

## Verify on Blockscout

```sh
forge verify-contract <POS_CONTRACT_ADDRESS> src/ProofOfSunlight.sol:ProofOfSunlight \
  --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api
```
