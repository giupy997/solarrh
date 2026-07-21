// Solar Ranch — on-chain configuration.
// Fill these in as things deploy; empty string = feature stays in demo/sim mode.
// For local rehearsals you can override via URL params: ?rpc=&pos=&node=&ranch=
window.SOLAR_RANCH_CONFIG = (function () {
  var cfg = {
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    chainId: 4663,
    // $RANCH token contract (from the launchpad). Empty until deployed.
    ranchAddress: "",
    // Threshold to unlock holder access, in whole tokens (18 decimals assumed).
    ranchThreshold: 1000000,
    // ProofOfSunlight contract. Empty until deployed.
    posAddress: "",
    // LONGHORN-01's node key address (registered on the PoS contract).
    nodeAddress: "",
  };
  try {
    var p = new URLSearchParams(window.location.search);
    if (p.get("rpc")) cfg.rpcUrl = p.get("rpc");
    if (p.get("pos")) cfg.posAddress = p.get("pos");
    if (p.get("node")) cfg.nodeAddress = p.get("node");
    if (p.get("ranch")) cfg.ranchAddress = p.get("ranch");
  } catch (e) { /* no URL params — fine */ }
  return cfg;
})();
