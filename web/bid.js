"use strict";
(function () {
  const { $, esc, num, fmtM, fmtInc, pct, sc, attachSuggest, parseM, store, statusBadge, teamName } = BF;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const roundUp = (v) => Math.ceil(v / 10000) * 10000;
  const pp = (x) => (x >= 0 ? "+" : "−") + Math.abs(x * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " %";
  let player = null;

  function compute(p, managers, need) {
    const P = p.price || 0;
    const h = p.hist.map((x) => x[1]);
    const change = h.length >= 4 ? (h[h.length - 1] - h[h.length - 4]) / h[h.length - 4] / 3 : (p.inc || 0) / (P || 1);
    const f = [];
    const add = (label, v) => { if (Math.abs(v) >= 0.001) f.push({ label, v }); return v; };
    let over = add("Base del mercado", 0.02);
    over += add(change >= 0 ? "Está subiendo de precio" : "Está bajando de precio", clamp(change * 3, -0.02, 0.1));
    const vi = sc(p).vi ?? 1;
    over += add(vi >= 1 ? "Da más puntos por millón que su posición" : "Da menos puntos por millón que su posición", clamp((vi - 1) * 0.06, -0.03, 0.12));
    over += add("Competencia en tu liga", clamp((managers - 4) * 0.008, 0, 0.08));
    over += add("Cuánto lo necesitas", [0, 0, 0.03, 0.07][need] || 0);
    if (p.status === "doubt") over += add("Es duda", -0.03);
    if ((p.pPlay ?? 1) < 0.5) over += add("Poca probabilidad de jugar", -0.02);
    over = clamp(over, 0.005, 0.4);
    return {
      over, factors: f,
      min: roundUp(P * (1 + Math.max(0.005, over * 0.4))),
      ideal: roundUp(P * (1 + over)),
      max: roundUp(P * (1 + over * 1.7 + 0.02)),
      tomorrow: P + (p.inc || 0),
    };
  }

  function render() {
    const box = $("#bid-result");
    if (!player) { box.innerHTML = `<div class="card"><p class="hint" style="margin:0">Busca un jugador para calcular la puja.</p></div>`; return; }
    const p = player;
    const managers = clamp(parseInt($("#bid-managers").value, 10) || 10, 2, 30);
    const need = parseInt($("#bid-need").value, 10) || 2;
    const budget = parseM($("#bid-budget").value);
    const r = compute(p, managers, need);
    const out = ["injured", "sanctioned", "discarded"].includes(p.status);
    let verdict = `Puja ${fmtM(r.ideal)} (${pp(r.over)} sobre su precio)`;
    if (out) verdict = `No pujaría ahora: está ${BF.STATUS[p.status].toLowerCase()}`;
    const warn = [];
    if (budget != null && budget < r.ideal) warn.push(budget >= r.min ? `Con tu saldo (${fmtM(budget)}) solo llegas a una puja ajustada: podrías perderlo.` : `Tu saldo (${fmtM(budget)}) no llega ni a la puja mínima.`);
    if ((p.inc || 0) > 0) warn.push(`Si nadie lo ficha, mañana costará unos ${fmtM(r.tomorrow)}.`);
    const inc = fmtInc(p.inc);
    box.innerHTML = `<section class="result">
      <div class="ph"><div><h2 style="margin:0"><a href="/jugador/${esc(p.slug)}/">${esc(p.name)}</a></h2>
        <p class="sub2">${esc(p.pos)} · ${esc(teamName(p.team))} · ${statusBadge(p)}</p></div>
        <div style="text-align:right"><div class="tile" style="display:inline-block"><div class="k">Precio hoy</div><div class="n" style="font-size:20px">${fmtM(p.price)}</div><div class="s ${inc.cls}">${inc.text}</div></div></div></div>
      <p class="verdict">${esc(verdict)}</p>
      <div class="bid-nums">
        <div class="tile"><div class="k">Mínima</div><div class="n" style="font-size:19px">${fmtM(r.min)}</div><div class="s">si hay poca competencia</div></div>
        <div class="tile main"><div class="k">Ideal</div><div class="n" style="font-size:19px">${fmtM(r.ideal)}</div><div class="s">${pp(r.over)}</div></div>
        <div class="tile"><div class="k">Máxima</div><div class="n" style="font-size:19px">${fmtM(r.max)}</div><div class="s">no pagues más</div></div>
      </div>
      ${warn.map((w) => `<p class="hint">${esc(w)}</p>`).join("")}
      <h3 style="margin-top:14px">Por qué</h3>
      <ul class="why">${r.factors.map((f) => `<li>${esc(f.label)}: ${pp(f.v)}</li>`).join("")}
        <li>${pct(p.pPlay)} de jugar · ${num(sc(p).xp)} puntos esperados en el próximo partido</li></ul>
    </section>`;
  }

  BF.loadData().then(() => {
    $("#bid-managers").value = store.get("bid-managers", 10);
    $("#bid-need").value = store.get("bid-need", 2);
    attachSuggest($("#bid-q"), $("#bid-suggest"), (p) => { player = p; $("#bid-q").placeholder = p.name; history.replaceState(null, "", `?p=${p.id}`); render(); },
      { filter: (p) => p.pos !== "ENT" });
    const id = Number(new URLSearchParams(location.search).get("p"));
    if (id && BF.byId.get(id)) { player = BF.byId.get(id); $("#bid-q").placeholder = player.name; }
    ["#bid-managers", "#bid-need", "#bid-budget"].forEach((s) => $(s).addEventListener("input", () => {
      store.set("bid-managers", $("#bid-managers").value); store.set("bid-need", $("#bid-need").value); render();
    }));
    document.addEventListener("bf:score", render);
    render();
  });
})();
