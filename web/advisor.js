"use strict";
(function () {
  const { $, $$, esc, num, fmtM, fmtInc, pct, sc, attachSuggest, parseM, teamName } = BF;
  const picked = [];

  function reasons(p) {
    const s = sc(p), nx = BF.data.teams[p.team]?.next;
    const apps = (s.fit || []).filter((x) => typeof x === "number").slice(0, 3);
    const out = [`${pct(p.pPlay)} de jugar`, `${num(s.xp)} puntos esperados`];
    if (nx) out.push(`${nx.home ? "juega en casa ante" : "juega fuera, en"} ${teamName(nx.opp)}`);
    if (apps.length) out.push(`últimas: ${apps.join(", ")} pts`);
    if (p.status !== "ok") out.push(BF.STATUS[p.status].toLowerCase());
    return out;
  }

  function renderVs() {
    $("#vs-picked").innerHTML = picked.map((p) => `<span>${esc(p.name)} <button aria-label="Quitar ${esc(p.name)}" data-unpick="${p.id}">×</button></span>`).join("");
    const box = $("#vs-result");
    if (picked.length < 2) { box.innerHTML = `<div class="card"><p class="hint" style="margin:0">${picked.length ? "Añade al menos otro jugador." : "Añade 2 jugadores, por ejemplo tus dos dudas para la delantera."}</p></div>`; return; }
    const ranked = [...picked].sort((a, b) => (sc(b).xp ?? 0) - (sc(a).xp ?? 0));
    const [a, b] = ranked;
    const xa = sc(a).xp ?? 0, xb = sc(b).xp ?? 0;
    const close = xa > 0 && (xa - xb) / xa < 0.1;
    let verdict = `Alinea a ${a.name}`;
    let sub = `Le sacamos ${num(xa - xb)} puntos esperados a ${b.name}.`;
    if (close) {
      const g = [a, b].sort((x, y) => (sc(y).pGood ?? 0) - (sc(x).pGood ?? 0))[0];
      verdict = `Muy igualado: nos quedamos con ${g.name}`;
      sub = `La diferencia en puntos esperados es pequeña; desempata su mayor probabilidad de buen partido (${pct(sc(g).pGood)}).`;
    }
    box.innerHTML = `<section class="result"><p class="verdict">${esc(verdict)}</p><p class="hint" style="margin-top:0">${esc(sub)}</p>
      <ol class="rank">${ranked.map((p, i) => `<li><span class="n">${i + 1}</span><div><a href="/jugador/${esc(p.slug)}/"><strong>${esc(p.name)}</strong></a> <span class="muted">${esc(p.pos)} · ${esc(teamName(p.team))}</span><small>${esc(reasons(p).join(" · "))}</small></div><span class="xp">${num(sc(p).xp)} pts</span></li>`).join("")}</ol></section>`;
    history.replaceState(null, "", "?" + picked.map((p, i) => `${"abcd"[i]}=${p.id}`).join("&"));
  }

  function renderFind() {
    const pos = $("#f-pos").value, max = parseM($("#f-max").value) ?? Infinity, goal = $("#f-goal").value;
    const score = {
      xp: (p) => sc(p).xp ?? 0,
      value: (p) => sc(p).vi ?? 0,
      rise: (p) => (p.inc || 0) / (p.price || 1),
    }[goal];
    const list = BF.data.players.filter((p) => (p.pos === pos || p.alt.includes(pos)) && (p.price ?? 0) <= max
      && !["injured", "sanctioned", "discarded"].includes(p.status) && (goal === "rise" || (p.pPlay ?? 0) >= 0.4))
      .sort((a, b) => score(b) - score(a)).slice(0, 10);
    const label = { xp: (p) => `${num(sc(p).xp)} pts`, value: (p) => `×${num(sc(p).vi, 2)}`, rise: (p) => fmtInc(p.inc).text }[goal];
    $("#find-result").innerHTML = list.length ? `<section class="result"><p class="verdict">${esc(list[0].name)} es tu mejor opción</p>
      <ol class="rank">${list.map((p, i) => `<li><span class="n">${i + 1}</span><div><a href="/jugador/${esc(p.slug)}/"><strong>${esc(p.name)}</strong></a> <span class="muted">${esc(teamName(p.team))} · ${fmtM(p.price)}</span><small>${esc(reasons(p).join(" · "))}</small></div><span class="xp">${esc(label(p))} <a class="btn" style="min-height:32px;padding:4px 10px;margin-left:6px" href="/puja/?p=${p.id}">Puja</a></span></li>`).join("")}</ol>
      ${goal === "value" ? `<p class="hint">×1 = puntos por millón en la mediana de su posición.</p>` : ""}</section>`
      : `<div class="card"><p class="hint" style="margin:0">No hay jugadores disponibles con esos filtros. Sube el precio máximo.</p></div>`;
  }

  function setMode(m) {
    $$(".tabs2 button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
    $("#mode-vs").hidden = m !== "vs"; $("#mode-find").hidden = m !== "find";
    if (m === "find") renderFind();
  }

  BF.loadData().then(() => {
    const params = new URLSearchParams(location.search);
    ["a", "b", "c", "d"].forEach((k) => { const p = BF.byId.get(Number(params.get(k))); if (p && !picked.includes(p)) picked.push(p); });
    attachSuggest($("#vs-q"), $("#vs-suggest"), (p) => { if (!picked.includes(p) && picked.length < 4) picked.push(p); renderVs(); },
      { filter: (p) => p.pos !== "ENT" });
    $("#vs-picked").addEventListener("click", (e) => {
      const b = e.target.closest("[data-unpick]"); if (!b) return;
      const i = picked.findIndex((p) => p.id === Number(b.dataset.unpick)); if (i >= 0) picked.splice(i, 1); renderVs();
    });
    $$(".tabs2 button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    ["#f-pos", "#f-max", "#f-goal"].forEach((s) => $(s).addEventListener("input", renderFind));
    document.addEventListener("bf:score", () => { renderVs(); renderFind(); });
    renderVs();
  });
})();
