"use strict";
(function () {
  const { $, esc, norm, num, fmtM, fmtInc, pct, sc, squad, store, rowHTML, attachSuggest, toggleSquad, POS_ORDER } = BF;
  const FORMATIONS = ["3-4-3", "3-5-2", "4-3-3", "4-4-2", "4-5-1", "5-3-2", "5-4-1"];
  let formation = store.get("formation", "best");

  const players = () => [...squad].map((id) => BF.byId.get(id)).filter(Boolean);
  const xp = (p) => sc(p).xp ?? 0;

  function lineupFor(list, f) {
    const [d, m, a] = f.split("-").map(Number);
    const need = { POR: 1, DEF: d, MED: m, DEL: a };
    const picked = {}, missing = {};
    let total = 0;
    for (const pos of ["POR", "DEF", "MED", "DEL"]) {
      const cands = list.filter((p) => p.pos === pos).sort((x, y) => xp(y) - xp(x));
      picked[pos] = cands.slice(0, need[pos]);
      missing[pos] = Math.max(0, need[pos] - cands.length);
      total += picked[pos].reduce((s, p) => s + xp(p), 0);
    }
    return { f, picked, missing, total };
  }

  function bestLineup(list) {
    if (formation !== "best") return lineupFor(list, formation);
    return FORMATIONS.map((f) => lineupFor(list, f))
      .sort((a, b) => (Object.values(a.missing).reduce((s, x) => s + x, 0) - Object.values(b.missing).reduce((s, x) => s + x, 0)) || b.total - a.total)[0];
  }

  function alertsFor(list) {
    const out = [];
    for (const p of list) {
      const fit = sc(p).fit || [];
      if (["injured", "sanctioned", "discarded"].includes(p.status)) out.push({ lvl: "critical", ic: "!", title: `${p.name}: ${BF.STATUS[p.status].toLowerCase()}`, text: p.info });
      else if (p.status === "doubt") out.push({ lvl: "warning", ic: "?", title: `${p.name} es duda (${pct(p.pPlay)} de jugar)`, text: p.info });
      else if (p.status === "warned") out.push({ lvl: "warning", ic: "!", title: `${p.name} está apercibido`, text: "Una amarilla más y se pierde el siguiente partido." });
      if (p.status === "ok" && fit.length > 1 && fit[0] == null && fit[1] == null) out.push({ lvl: "info", ic: "i", title: `${p.name} no ha jugado las 2 últimas jornadas`, text: "Riesgo de suplencia aunque esté disponible." });
      const h = p.hist.map((x) => x[1]);
      if (h.length >= 4 && h.slice(-4).every((v, i, a) => i === 0 || v < a[i - 1])) out.push({ lvl: "info", ic: "▼", title: `${p.name} lleva 3 días bajando`, text: `Ha perdido ${fmtM(h[h.length - 4] - h[h.length - 1])}. Valora venderlo.` });
      else if ((p.inc ?? 0) < 0) out.push({ lvl: "info", ic: "▼", title: `${p.name} baja hoy`, text: fmtInc(p.inc).text });
    }
    const order = { critical: 0, warning: 1, info: 2 };
    return out.sort((a, b) => order[a.lvl] - order[b.lvl]);
  }

  function chip(p) {
    return `<div class="chip-p"><b><a href="/jugador/${esc(p.slug)}/">${esc(p.name)}</a></b>${pct(p.pPlay)} · ${num(xp(p))} pts</div>`;
  }

  function render() {
    const list = players().sort((a, b) => POS_ORDER.indexOf(a.pos) - POS_ORDER.indexOf(b.pos) || xp(b) - xp(a));
    if (!list.length) {
      $("#squad-summary").innerHTML = ""; $("#squad-lineup").innerHTML = ""; $("#squad-alerts").innerHTML = "";
      $("#squad-list").innerHTML = `<div class="card"><h2>Empieza añadiendo tus jugadores</h2><p class="hint" style="margin:0">Búscalos arriba, pega una lista de nombres o pulsa + en cualquier jugador de la web.</p></div>`;
      return;
    }
    const value = list.reduce((a, p) => a + (p.price || 0), 0);
    const change = list.reduce((a, p) => a + (p.inc || 0), 0);
    const ch = fmtInc(change);
    const lu = bestLineup(list);
    const alerts = alertsFor(list);
    const starters = Object.values(lu.picked).flat();
    const risky = starters.filter((p) => (p.pPlay ?? 1) < 0.5);
    $("#squad-summary").innerHTML = `
      <div class="tile"><div class="k">Valor de la plantilla</div><div class="n">${fmtM(value)}</div><div class="s">${list.length} jugadores</div></div>
      <div class="tile"><div class="k">Variación hoy</div><div class="n ${ch.cls}">${ch.text}</div></div>
      <div class="tile"><div class="k">Puntos esperados del once</div><div class="n">${num(lu.total)}</div><div class="s">próxima jornada</div></div>
      <div class="tile"><div class="k">Alertas</div><div class="n">${alerts.filter((a) => a.lvl !== "info").length}</div><div class="s">${alerts.length} avisos en total</div></div>`;

    const missingTxt = Object.entries(lu.missing).filter(([, n]) => n).map(([pos, n]) => `${n} ${pos}`).join(", ");
    const opts = [`<option value="best"${formation === "best" ? " selected" : ""}>Mejor formación (${lu.f})</option>`]
      .concat(FORMATIONS.map((f) => `<option${formation === f ? " selected" : ""}>${f}</option>`)).join("");
    const bench = list.filter((p) => !starters.includes(p) && p.pos !== "ENT").sort((a, b) => xp(b) - xp(a));
    const rowsPos = ["POR", "DEF", "MED", "DEL"].map((pos) =>
      `<div class="line-row">${lu.picked[pos].map(chip).join("")}${Array(lu.missing[pos]).fill(`<div class="chip-p"><b>Falta</b>${pos}</div>`).join("")}</div>`).join("");
    $("#squad-lineup").innerHTML = `<section class="lineup">
      <div class="lineup-head"><h2>Once ideal · ${num(lu.total)} puntos esperados</h2>
        <select id="formation" aria-label="Formación">${opts}</select></div>
      ${missingTxt ? `<p class="hint">Te faltan jugadores para esta formación: ${esc(missingTxt)}.</p>` : ""}
      ${risky.length ? `<p class="hint">Ojo: ${risky.map((p) => esc(p.name)).join(", ")} ${risky.length > 1 ? "tienen" : "tiene"} menos de un 50 % de jugar y no tienes un sustituto mejor.</p>` : ""}
      <div class="pitch">${rowsPos}</div>
      ${bench.length ? `<p class="bench"><strong>Banquillo:</strong> ${bench.map((p) => `${esc(p.name)} (${pct(p.pPlay)})`).join(" · ")}</p>` : ""}
    </section>`;
    $("#formation").addEventListener("change", (e) => { formation = e.target.value; store.set("formation", formation); render(); });

    $("#squad-alerts").innerHTML = `<h2>Alertas</h2>` + (alerts.length
      ? `<div class="alerts">${alerts.map((a) => `<div class="alert ${a.lvl}"><span class="ic" aria-hidden="true">${a.ic}</span><div><strong>${esc(a.title)}</strong>${a.text ? `<small>${esc(a.text)}</small>` : ""}</div></div>`).join("")}</div>`
      : `<p class="hint">Sin alertas: todos disponibles y sin bajadas de precio.</p>`);

    const thr = BF.data.goodThreshold[BF.getScore()] ?? 6;
    $("#squad-list").innerHTML = `<h2>Tus jugadores (${list.length})</h2><div class="list">` + list.map((p) => rowHTML(p,
      p.pos === "ENT" ? "" : `<p class="row-info">Buen partido (≥${thr} pts): <strong>${pct(sc(p).pGood)}</strong> · Puntos esperados: <strong>${num(xp(p))}</strong>${p.why?.length ? " · " + esc(p.why[0]) : ""}</p>`)).join("") + `</div>`;
    BF.syncToggles();
  }

  function pasteImport() {
    const names = $("#paste-box").value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const added = [], missing = [];
    for (const raw of names) {
      const q = norm(raw);
      const pool = BF.data.players;
      const best = (arr) => arr.sort((a, b) => b.price - a.price)[0];
      const hit = best(pool.filter((p) => norm(p.name) === q)) || best(pool.filter((p) => norm(p.name).startsWith(q)))
        || best(pool.filter((p) => norm(p.name).includes(q))) || best(pool.filter((p) => q.includes(norm(p.name)) && norm(p.name).length > 3));
      if (hit) { if (!squad.has(hit.id)) { squad.add(hit.id); added.push(hit.name); } } else missing.push(raw);
    }
    store.set("squad", [...squad]);
    $("#paste-result").textContent = `${added.length} añadidos.` + (missing.length ? ` No encontrados: ${missing.join(", ")}.` : "");
    if (added.length) $("#paste-box").value = missing.join("\n");
    render();
  }

  BF.loadData().then(() => {
    attachSuggest($("#squad-q"), $("#squad-suggest"), (p) => { if (!squad.has(p.id)) toggleSquad(p.id); },
      { right: (p) => squad.has(p.id) ? "✓ en plantilla" : fmtM(p.price) });
    $("#paste-go").addEventListener("click", pasteImport);
    document.addEventListener("bf:squad", render);
    document.addEventListener("bf:score", render);
    render();
  });
})();
