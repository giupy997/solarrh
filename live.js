// Solar Ranch — live on-chain feed. Zero dependencies, read-only JSON-RPC only.
// Activates itself when config.js has addresses; otherwise the site stays in
// simulated mode. Never asks for a wallet, never sends a transaction.

(function () {
  "use strict";

  var cfg = window.SOLAR_RANCH_CONFIG || {};

  // Selectors / topics (precomputed from the ABIs):
  var SEL_LATEST = "0x4a4aac1a";     // latest(address)
  var SEL_BALANCE_OF = "0x70a08231"; // balanceOf(address)
  var TOPIC_EPOCH = "0x6e95d77d28590bf98c4f4570baea8a19c40d52c69ed9baea175f20341eeb086b"; // Epoch(...)

  function pad32(addr) {
    return "000000000000000000000000" + addr.toLowerCase().replace(/^0x/, "");
  }

  function rpc(method, params) {
    return fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.error) throw new Error(j.error.message || "rpc error");
      return j.result;
    });
  }

  function ethCall(to, data) {
    return rpc("eth_call", [{ to: to, data: data }, "latest"]);
  }

  function word(hex, i) {
    // i-th 32-byte word of an 0x-prefixed return blob, as BigInt
    return BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
  }

  // ---------- $RANCH balance (read-only) ----------

  window.SolarRanchLive = {
    checkBalance: function (addr) {
      return ethCall(cfg.ranchAddress, SEL_BALANCE_OF + pad32(addr))
        .then(function (res) {
          var raw = BigInt(res);
          var whole = raw / (10n ** 18n);
          var passes = whole >= BigInt(cfg.ranchThreshold);
          return { ok: true, balanceFmt: whole.toLocaleString("en-US"), passes: passes };
        })
        .catch(function (e) { return { ok: false, error: String(e.message || e).slice(0, 80) }; });
    },
  };

  // ---------- Proof of Sunlight feed ----------

  if (!cfg.posAddress || !cfg.nodeAddress) return; // stays simulated

  function pollLatest() {
    return ethCall(cfg.posAddress, SEL_LATEST + pad32(cfg.nodeAddress)).then(function (res) {
      var epochCount = Number(word(res, 2));
      if (epochCount === 0) return false;
      var solarDw = Number(word(res, 4));
      var batteryPct = Number(word(res, 5));
      var servedMb = Number(word(res, 6));
      window.SolarRanch.goLive();
      window.SolarRanch.setTiles(solarDw / 10, batteryPct, servedMb / 1000, epochCount);
      return true;
    });
  }

  function loadHistory() {
    return rpc("eth_getLogs", [{
      address: cfg.posAddress,
      topics: [TOPIC_EPOCH, "0x" + pad32(cfg.nodeAddress)],
      fromBlock: "0x0",
      toBlock: "latest",
    }]).then(function (logs) {
      if (!logs || logs.length < 2) return; // not enough points for a curve yet
      var series = logs.slice(-144).map(function (log) {
        var solarDw = Number(word(log.data, 0));
        var ts = Number(word(log.data, 4));
        var d = new Date(ts * 1000);
        return { hour: d.getHours() + d.getMinutes() / 60, w: solarDw / 10 };
      });
      window.SolarRanch.renderChart(series);
    });
  }

  function tickLive() {
    pollLatest().then(function (hasData) {
      if (hasData) return loadHistory();
    }).catch(function (e) {
      // RPC hiccup: keep whatever is on screen, retry next tick
      console.warn("[solar-ranch] live poll failed:", e.message);
    });
  }

  tickLive();
  setInterval(tickLive, 60000);
})();
