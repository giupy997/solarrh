// Solar Ranch — telemetry dashboard (simulated until the chain feed is live)
// + no-wallet-connect access check. live.js swaps in real data when configured.

(function () {
  "use strict";

  var PANEL_W = 200;
  var POINTS = 145; // 24h at 10-min epochs

  // ---------- simulated solar day ----------

  function noise(i) {
    var x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x); // 0..1, deterministic
  }

  function solarAt(hourFloat, i) {
    var sunrise = 6.0, sunset = 21.0;
    if (hourFloat < sunrise || hourFloat > sunset) return 0;
    var t = (hourFloat - sunrise) / (sunset - sunrise);
    var bell = Math.sin(Math.PI * t);
    var w = PANEL_W * 0.92 * Math.pow(bell, 1.35);
    var dip = 1 - 0.18 * Math.pow(noise(i), 6);
    var jitter = 1 + (noise(i * 7 + 3) - 0.5) * 0.06;
    return Math.max(0, w * dip * jitter);
  }

  var NOW_H = 14.5;
  var simSeries = [];
  for (var i = 0; i < POINTS; i++) {
    var h = NOW_H - 24 + (24 * i) / (POINTS - 1);
    var hh = ((h % 24) + 24) % 24;
    simSeries.push({ hour: hh, w: solarAt(hh, i) });
  }

  function fmtHour(hh) {
    var H = Math.floor(hh), M = Math.round((hh - H) * 60);
    if (M === 60) { H = (H + 1) % 24; M = 0; }
    return (H < 10 ? "0" + H : H) + ":" + (M < 10 ? "0" + M : M);
  }

  // ---------- stat tiles ----------

  var elWatts = document.getElementById("t-watts");
  var elBatt = document.getElementById("t-batt");
  var elData = document.getElementById("t-data");
  var elEpochs = document.getElementById("t-epochs");
  var elWattsSub = document.getElementById("t-watts-sub");

  function setTiles(watts, batteryPct, servedGb, epochs) {
    elWatts.textContent = watts.toFixed(1);
    elBatt.textContent = Math.round(batteryPct);
    elData.textContent = servedGb.toFixed(1);
    elEpochs.textContent = String(epochs);
    var pct = Math.round((watts / PANEL_W) * 100);
    elWattsSub.innerHTML = '<span class="up">' + pct + "%</span> of 200 W panel";
  }

  // sim mode: gentle live jitter so the page feels alive
  var live = false;
  var simLast = simSeries[simSeries.length - 1];
  var simServed = 14.2;
  var tick = 0;
  setTiles(simLast.w, 83, simServed, 144);
  setInterval(function () {
    if (live) return;
    tick++;
    var wNow = Math.max(0, simLast.w * (1 + (noise(tick) - 0.5) * 0.05));
    simServed += 0.0004 + noise(tick * 3) * 0.0006;
    setTiles(wNow, 83, simServed, 144);
  }, 2000);

  // ---------- chart (SVG line, single series) ----------

  var box = document.getElementById("chart-box");
  var tooltip = document.getElementById("chart-tooltip");
  var tableBox = document.getElementById("chart-table");
  var toggle = document.getElementById("table-toggle");
  var chartSeries = simSeries;

  var W = 1040, H = 300;
  var PAD = { l: 46, r: 14, t: 14, b: 30 };
  var plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  var yMax = 200;

  function renderChart(series) {
    chartSeries = series;
    var n = series.length;
    var px = function (i) { return PAD.l + (plotW * i) / (n - 1); };
    var py = function (w) { return PAD.t + plotH * (1 - Math.min(w, yMax) / yMax); };

    var lineD = "";
    series.forEach(function (p, i) {
      lineD += (i === 0 ? "M" : "L") + px(i).toFixed(1) + " " + py(p.w).toFixed(1) + " ";
    });
    var areaD = lineD + "L" + px(n - 1).toFixed(1) + " " + py(0) + " L" + px(0).toFixed(1) + " " + py(0) + " Z";

    var gridY = [0, 50, 100, 150, 200];
    var gridLines = gridY.map(function (v) {
      return '<line x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + py(v) + '" y2="' + py(v) +
        '" stroke="#2a2414" stroke-width="1"/>' +
        '<text x="' + (PAD.l - 10) + '" y="' + (py(v) + 4) + '" text-anchor="end" ' +
        'font-family="Space Mono, monospace" font-size="11" fill="#8b8577">' + v + "</text>";
    }).join("");

    var xLabels = "";
    var step = Math.max(1, Math.floor(n / 6));
    for (var k = 0; k < n; k += step) {
      xLabels += '<text x="' + px(k) + '" y="' + (H - 8) + '" text-anchor="middle" ' +
        'font-family="Space Mono, monospace" font-size="11" fill="#8b8577">' + fmtHour(series[k].hour) + "</text>";
    }

    var old = box.querySelector("svg");
    if (old) old.remove();
    var svg =
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-hidden="false">' +
      '<defs><linearGradient id="fillg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#ccff00" stop-opacity="0.22"/>' +
      '<stop offset="100%" stop-color="#ccff00" stop-opacity="0"/>' +
      "</linearGradient></defs>" +
      gridLines + xLabels +
      '<path d="' + areaD + '" fill="url(#fillg)"/>' +
      '<path d="' + lineD + '" fill="none" stroke="#ccff00" stroke-width="2" stroke-linejoin="round"/>' +
      '<line id="xhair" x1="0" x2="0" y1="' + PAD.t + '" y2="' + (PAD.t + plotH) + '" stroke="#8b8577" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>' +
      '<circle id="xdot" r="4" fill="#ccff00" stroke="#100d05" stroke-width="2" style="display:none"/>' +
      "</svg>";
    box.insertAdjacentHTML("beforeend", svg);

    var svgEl = box.querySelector("svg");
    var xhair = box.querySelector("#xhair");
    var xdot = box.querySelector("#xdot");

    function hide() {
      xhair.style.display = "none"; xdot.style.display = "none"; tooltip.style.display = "none";
    }
    svgEl.addEventListener("mousemove", function (e) {
      var r = svgEl.getBoundingClientRect();
      var sx = ((e.clientX - r.left) / r.width) * W;
      var idx = Math.round(((sx - PAD.l) / plotW) * (n - 1));
      if (idx < 0 || idx > n - 1) { hide(); return; }
      var p = series[idx];
      var cx = px(idx), cy = py(p.w);
      xhair.setAttribute("x1", cx); xhair.setAttribute("x2", cx);
      xhair.style.display = "block";
      xdot.setAttribute("cx", cx); xdot.setAttribute("cy", cy);
      xdot.style.display = "block";
      tooltip.innerHTML = '<span class="t">' + fmtHour(p.hour) + "</span>" + p.w.toFixed(1) + " W";
      tooltip.style.display = "block";
      tooltip.style.left = (cx / W) * 100 + "%";
      tooltip.style.top = (cy / H) * 100 + "%";
    });
    svgEl.addEventListener("mouseleave", hide);
    tableBox.innerHTML = "";
    tableBuilt = false;
  }

  // ---------- table view (accessibility / data fallback) ----------

  var tableBuilt = false;
  toggle.addEventListener("click", function () {
    if (!tableBuilt) {
      var rows = "";
      var step = Math.max(1, Math.floor(chartSeries.length / 24));
      for (var j = 0; j < chartSeries.length; j += step) {
        rows += "<tr><td>" + fmtHour(chartSeries[j].hour) + "</td><td>" + chartSeries[j].w.toFixed(1) + "</td></tr>";
      }
      tableBox.innerHTML = "<table><thead><tr><th>Time</th><th>Solar output (W)</th></tr></thead><tbody>" + rows + "</tbody></table>";
      tableBuilt = true;
    }
    var open = tableBox.style.display === "block";
    tableBox.style.display = open ? "none" : "block";
    toggle.textContent = open ? "View as table" : "Hide table";
  });

  renderChart(simSeries);

  // ---------- hooks for live.js ----------

  window.SolarRanch = {
    setTiles: setTiles,
    renderChart: renderChart,
    goLive: function () {
      live = true;
      var badge = document.getElementById("telemetry-badge");
      if (badge) {
        badge.textContent = "Live — on-chain";
        badge.className = "badge badge-build";
      }
      var note = document.getElementById("telemetry-note");
      if (note) {
        note.innerHTML = "<b style='color:#ccff00'>LIVE DATA.</b> Read from the Proof of Sunlight contract on Robinhood Chain — verify every epoch on the explorer.";
      }
    },
  };

  // ---------- access check (read-only; real balanceOf via live.js when configured) ----------

  var input = document.getElementById("access-input");
  var btn = document.getElementById("access-btn");
  var result = document.getElementById("access-result");

  function check() {
    var v = input.value.trim();
    result.className = "";
    if (!v) { result.textContent = ""; return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
      result.className = "err show";
      result.textContent = "✕ Not a valid EVM address (0x + 40 hex chars).";
      return;
    }
    var cfg = window.SOLAR_RANCH_CONFIG || {};
    if (cfg.ranchAddress && window.SolarRanchLive) {
      result.className = "show";
      result.textContent = "… checking balance (read-only RPC call)";
      window.SolarRanchLive.checkBalance(v).then(function (r) {
        if (r.ok) {
          result.className = "ok show";
          result.textContent = "✓ " + r.balanceFmt + " $RANCH — " +
            (r.passes ? "access threshold met. Welcome to the Herd." :
              "below the " + cfg.ranchThreshold.toLocaleString("en-US") + " $RANCH access threshold.");
        } else {
          result.className = "err show";
          result.textContent = "✕ RPC error: " + r.error + " — try again in a moment.";
        }
      });
      return;
    }
    result.className = "ok show";
    result.textContent =
      "✓ Address format valid. DEMO MODE — $RANCH isn't deployed yet. Once live, this runs a " +
      "read-only balanceOf() against Robinhood Chain RPC (id 4663). Nothing is signed or stored.";
  }
  btn.addEventListener("click", check);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") check(); });
})();
