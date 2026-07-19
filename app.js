// Solar Ranch — simulated telemetry dashboard + read-only access check (demo).
// All data here is SIMULATED in-browser; nothing is fetched, nothing is signed.

(function () {
  "use strict";

  // ---------- simulated solar day ----------
  // Clear-sky model: sunrise ~06:00, peak ~13:00, sunset ~21:00 (July).
  // Deterministic pseudo-noise so the curve is stable across reloads.

  var PANEL_W = 200;
  var POINTS = 145; // 24h at 10-min epochs

  function noise(i) {
    var x = Math.sin(i * 12.9898) * 43758.5453;
    return x - Math.floor(x); // 0..1, deterministic
  }

  function solarAt(hourFloat, i) {
    var sunrise = 6.0, sunset = 21.0, peak = 13.0;
    if (hourFloat < sunrise || hourFloat > sunset) return 0;
    var t = (hourFloat - sunrise) / (sunset - sunrise); // 0..1
    var bell = Math.sin(Math.PI * t);
    var w = PANEL_W * 0.92 * Math.pow(bell, 1.35);
    // passing-cloud dips
    var dip = 1 - 0.18 * Math.pow(noise(i), 6);
    var jitter = 1 + (noise(i * 7 + 3) - 0.5) * 0.06;
    return Math.max(0, w * dip * jitter);
  }

  // Build 24h series ending "now" (simulated clock pinned to a nice demo time).
  var NOW_H = 14.5; // 14:30 — afternoon, healthy output
  var series = [];
  for (var i = 0; i < POINTS; i++) {
    var h = NOW_H - 24 + (24 * i) / (POINTS - 1); // hours, may be negative (=prev day)
    var hh = ((h % 24) + 24) % 24;
    series.push({ hour: hh, w: solarAt(hh, i) });
  }

  function fmtHour(hh) {
    var H = Math.floor(hh), M = Math.round((hh - H) * 60);
    if (M === 60) { H = (H + 1) % 24; M = 0; }
    return (H < 10 ? "0" + H : H) + ":" + (M < 10 ? "0" + M : M);
  }

  // ---------- stat tiles ----------
  var last = series[series.length - 1];
  var elWatts = document.getElementById("t-watts");
  var elBatt = document.getElementById("t-batt");
  var elData = document.getElementById("t-data");
  var elEpochs = document.getElementById("t-epochs");
  var elWattsSub = document.getElementById("t-watts-sub");

  var battery = 83;
  var served = 14.2; // GB over 24h

  function renderTiles(wNow) {
    elWatts.textContent = wNow.toFixed(1);
    elBatt.textContent = Math.round(battery);
    elData.textContent = served.toFixed(1);
    elEpochs.textContent = "144";
    var pct = Math.round((wNow / PANEL_W) * 100);
    elWattsSub.innerHTML = '<span class="up">' + pct + "%</span> of 200 W panel";
  }
  renderTiles(last.w);

  // gentle live jitter on the "now" watts, so the page feels alive
  var tick = 0;
  setInterval(function () {
    tick++;
    var wNow = Math.max(0, last.w * (1 + (noise(tick) - 0.5) * 0.05));
    served += 0.0004 + noise(tick * 3) * 0.0006;
    renderTiles(wNow);
  }, 2000);

  // ---------- chart (SVG line, single series) ----------
  var box = document.getElementById("chart-box");
  var tooltip = document.getElementById("chart-tooltip");

  var W = 1040, H = 300;
  var PAD = { l: 46, r: 14, t: 14, b: 30 };
  var plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  var yMax = 200;

  function px(i) { return PAD.l + (plotW * i) / (POINTS - 1); }
  function py(w) { return PAD.t + plotH * (1 - w / yMax); }

  var lineD = "", areaD = "";
  series.forEach(function (p, i) {
    var cmd = i === 0 ? "M" : "L";
    lineD += cmd + px(i).toFixed(1) + " " + py(p.w).toFixed(1) + " ";
  });
  areaD = lineD + "L" + px(POINTS - 1).toFixed(1) + " " + py(0) + " L" + px(0).toFixed(1) + " " + py(0) + " Z";

  var gridY = [0, 50, 100, 150, 200];
  var gridLines = gridY.map(function (v) {
    return '<line x1="' + PAD.l + '" x2="' + (W - PAD.r) + '" y1="' + py(v) + '" y2="' + py(v) +
      '" stroke="#161d2a" stroke-width="1"/>' +
      '<text x="' + (PAD.l - 10) + '" y="' + (py(v) + 4) + '" text-anchor="end" ' +
      'font-family="IBM Plex Mono, monospace" font-size="11" fill="#5c6575">' + v + "</text>";
  }).join("");

  // x labels every 4 hours
  var xLabels = "";
  for (var k = 0; k < POINTS; k += 24) {
    xLabels += '<text x="' + px(k) + '" y="' + (H - 8) + '" text-anchor="middle" ' +
      'font-family="IBM Plex Mono, monospace" font-size="11" fill="#5c6575">' + fmtHour(series[k].hour) + "</text>";
  }

  var svg =
    '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-hidden="false">' +
    '<defs><linearGradient id="fillg" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="#ccff00" stop-opacity="0.22"/>' +
    '<stop offset="100%" stop-color="#ccff00" stop-opacity="0"/>' +
    "</linearGradient></defs>" +
    gridLines + xLabels +
    '<path d="' + areaD + '" fill="url(#fillg)"/>' +
    '<path d="' + lineD + '" fill="none" stroke="#ccff00" stroke-width="2" stroke-linejoin="round"/>' +
    '<line id="xhair" x1="0" x2="0" y1="' + PAD.t + '" y2="' + (PAD.t + plotH) + '" stroke="#5c6575" stroke-width="1" stroke-dasharray="3 3" style="display:none"/>' +
    '<circle id="xdot" r="4" fill="#ccff00" stroke="#07090d" stroke-width="2" style="display:none"/>' +
    "</svg>";
  box.insertAdjacentHTML("beforeend", svg);

  var svgEl = box.querySelector("svg");
  var xhair = box.querySelector("#xhair");
  var xdot = box.querySelector("#xdot");

  svgEl.addEventListener("mousemove", function (e) {
    var r = svgEl.getBoundingClientRect();
    var sx = ((e.clientX - r.left) / r.width) * W;
    var i = Math.round(((sx - PAD.l) / plotW) * (POINTS - 1));
    if (i < 0 || i > POINTS - 1) { hide(); return; }
    var p = series[i];
    var cx = px(i), cy = py(p.w);
    xhair.setAttribute("x1", cx); xhair.setAttribute("x2", cx);
    xhair.style.display = "block";
    xdot.setAttribute("cx", cx); xdot.setAttribute("cy", cy);
    xdot.style.display = "block";
    tooltip.innerHTML = '<span class="t">' + fmtHour(p.hour) + "</span>" + p.w.toFixed(1) + " W";
    tooltip.style.display = "block";
    tooltip.style.left = (cx / W) * 100 + "%";
    tooltip.style.top = (cy / H) * 100 + "%";
  });
  function hide() {
    xhair.style.display = "none"; xdot.style.display = "none"; tooltip.style.display = "none";
  }
  svgEl.addEventListener("mouseleave", hide);

  // ---------- table view (accessibility / data fallback) ----------
  var tableBox = document.getElementById("chart-table");
  var toggle = document.getElementById("table-toggle");
  var tableBuilt = false;
  toggle.addEventListener("click", function () {
    if (!tableBuilt) {
      var rows = "";
      for (var j = 0; j < POINTS; j += 6) { // hourly rows
        rows += "<tr><td>" + fmtHour(series[j].hour) + "</td><td>" + series[j].w.toFixed(1) + "</td></tr>";
      }
      tableBox.innerHTML = "<table><thead><tr><th>Time</th><th>Solar output (W)</th></tr></thead><tbody>" + rows + "</tbody></table>";
      tableBuilt = true;
    }
    var open = tableBox.style.display === "block";
    tableBox.style.display = open ? "none" : "block";
    toggle.textContent = open ? "View as table" : "Hide table";
  });

  // ---------- access check (demo — no RPC call, token not deployed) ----------
  var input = document.getElementById("access-input");
  var btn = document.getElementById("access-btn");
  var result = document.getElementById("access-result");

  function check() {
    var v = input.value.trim();
    result.className = "";
    if (!v) { result.textContent = ""; return; }
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
      result.className = "err";
      result.textContent = "✕ Not a valid EVM address (0x + 40 hex chars).";
      return;
    }
    result.className = "ok";
    result.textContent =
      "✓ Address format valid. DEMO MODE — $RANCH isn't deployed yet. Once live, this runs a " +
      "read-only balanceOf() against Robinhood Chain RPC (id 4663). Nothing is signed or stored.";
  }
  btn.addEventListener("click", check);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") check(); });
})();
