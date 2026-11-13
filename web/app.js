"use strict";

const COMPETITION = "la-liga";
const PAGE = 60;
const STATUS = {
  ok: { label: "Disponible", level: "good" },
  doubt: { label: "Duda", level: "warning" },
  warned: { label: "Apercibido", level: "warning" },
  injured: { label: "Lesionado", level: "critical" },
  sanctioned: { label: "Sancionado", level: "critical" },
  discarded: { label: "Descartado", level: "critical" },
};

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento */ }
  },
};

const state = {
  data: null,
  byId: new Map(),
  score: store.get("score", "1"),
  squad: new Set(store.get("squad", [])),
  tab: "players",
  q: "", pos: "", team: "", status: "", sort: "pts",
  shown: PAGE,
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const fmtM = (v) => v == null ? "—" : (v / 1e6).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " M";
function fmtInc(v) {
  if (!v) return { text: "=", cls: "flat" };
  const abs = Math.abs(v);
  const txt = abs >= 1e6 ? (abs / 1e6).toLocaleString("es-ES", { maximumFractionDigits: 2 }) + " M" : Math.round(abs / 1e3).toLocaleString("es-ES") + " k";
  return { text: (v > 0 ? "▲ +" : "▼ −") + txt, cls: v > 0 ? "up" : "down" };
}
const fmtDate = (ts) => new Date(ts * 1000).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (ts) => new Date(ts * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

// --- Métricas por jugador (dependen del sistema de puntuación elegido) ---
const sc = (p) => p.scores[state.score] || { pts: null, fit: [] };
const pts = (p) => sc(p).pts ?? 0;
const avg = (p) => p.played ? pts(p) / p.played : 0;
// fitness viene de más reciente a más antigua; la mostramos en orden cronológico.
const fitChrono = (p) => [...(sc(p).fit || [])].reverse();
const formSum = (p) => (sc(p).fit || []).reduce((a, x) => a + (typeof x === "number" ? x : 0), 0);
const perMillion = (p) => p.price ? pts(p) / (p.price / 1e6) : 0;
const teamName = (id) => state.data.teams[id]?.name ?? "—";

const SORTS = {
  pts: (a, b) => pts(b) - pts(a),
  avg: (a, b) => avg(b) - avg(a),
  form: (a, b) => formSum(b) - formSum(a),
  value: (a, b) => perMillion(b) - perMillion(a),
  inc: (a, b) => (b.inc ?? 0) - (a.inc ?? 0),
  dec: (a, b) => (a.inc ?? 0) - (b.inc ?? 0),
  price: (a, b) => (b.price ?? 0) - (a.price ?? 0),
  cheap: (a, b) => (a.price ?? 0) - (b.price ?? 0),
};

// --- Piezas de interfaz ---
function statusBadge(p) {
  const s = STATUS[p.status] || { label: p.status || "?", level: "" };
  return `<span class="st st-${esc(p.status)}"><span class="dot" aria-hidden="true"></span>${esc(s.label)}</span>`;
}

function formBoxes(p) {
  const fit = fitChrono(p);
  if (!fit.length) return "";
  const n = fit.length;
  return `<div class="form" aria-label="Últimas ${n} jornadas">` + fit.map((x, i) => {
    const when = i === n - 1 ? "Última jornada" : `Hace ${n - 1 - i} jornadas`;
    if (typeof x === "number") {
      const cls = x >= 8 ? "hi" : x >= 4 ? "mid" : x < 0 ? "neg" : "";
      return `<span class="fb ${cls}" title="${when}: ${x} puntos">${x}</span>`;
    }
    const label = x == null ? "No jugó" : (STATUS[x]?.label ?? x);
    const short = x == null ? "–" : x === "injured" ? "L" : x === "sanctioned" ? "S" : x === "doubt" ? "D" : "·";
    return `<span class="fb out" title="${when}: ${esc(label)}">${short}</span>`;
  }).join("") + `</div>`;
}

function nextGame(p) {
  const nx = state.data.teams[p.team]?.next;
  if (!nx) return "";
  const opp = teamName(nx.opp);
  return `<span title="${nx.date ? esc(fmtDate(nx.date) + " " + fmtTime(nx.date)) : ""}">${nx.home ? "vs" : "en"} ${esc(opp)}</span>`;
}

function row(p) {
  const inc = fmtInc(p.inc);
  const inSquad = state.squad.has(p.id);
  return `<article class="row">
    <div class="who">
      <span class="pos">${esc(p.pos)}</span>
      <div style="min-width:0">
        <button class="name" data-open="${p.id}">${esc(p.name)}</button>
        <div class="team">${esc(teamName(p.team))}</div>
      </div>
    </div>
    <div class="meta">${statusBadge(p)} ${nextGame(p)}</div>
    <div class="stats"><b>${pts(p)}</b> pts · media <b>${avg(p).toLocaleString("es-ES", { maximumFractionDigits: 1 })}</b> · ${p.played} PJ</div>
    ${formBoxes(p)}
    <div class="price">
      <div><span class="v">${fmtM(p.price)}</span><span class="d ${inc.cls}">${inc.text}</span></div>
      <button class="add ${inSquad ? "in" : ""}" data-toggle="${p.id}" aria-label="${inSquad ? "Quitar de" : "Añadir a"} mi plantilla" title="${inSquad ? "Quitar de" : "Añadir a"} mi plantilla">${inSquad ? "✓" : "+"}</button>
    </div>
  </article>`;
}

// --- Pestaña Jugadores ---
function filtered() {
  const q = norm(state.q);
  return state.data.players.filter((p) =>
    (!state.pos ? p.pos !== "ENT" : p.pos === state.pos || p.alt.includes(state.pos)) &&
    (!state.team || String(p.team) === state.team) &&
    (!state.status || p.status === state.status) &&
    (!q || norm(p.name).includes(q) || norm(teamName(p.team)).includes(q))
  ).sort(SORTS[state.sort]);
}

function renderPlayers() {
  const list = filtered();
  $("#players-list").innerHTML = list.length
    ? list.slice(0, state.shown).map(row).join("")
    : `<p class="empty">No hay jugadores con esos filtros.</p>`;
  $("#more").hidden = list.length <= state.shown;
  $("#more").textContent = `Mostrar más (${list.length - state.shown} restantes)`;
}

// --- Pestaña Mi plantilla ---
function squadPlayers() {
  return [...state.squad].map((id) => state.byId.get(id)).filter(Boolean);
}

function alertsFor(players) {
  const out = [];
  for (const p of players) {
    const fit = sc(p).fit || [];
    if (p.status === "injured" || p.status === "sanctioned" || p.status === "discarded") {
      out.push({ lvl: "critical", ic: "!", p, title: `${p.name}: ${STATUS[p.status].label.toLowerCase()}`, text: p.info });
    } else if (p.status === "doubt") {
      out.push({ lvl: "warning", ic: "?", p, title: `${p.name} es duda`, text: p.info });
    } else if (p.status === "warned") {
      out.push({ lvl: "warning", ic: "!", p, title: `${p.name} está apercibido`, text: "Una amarilla más y se pierde el siguiente partido." });
    }
    if (p.status === "ok" && fit.length && fit[0] == null && fit[1] == null) {
      out.push({ lvl: "info", ic: "i", p, title: `${p.name} no ha jugado las 2 últimas jornadas`, text: "Riesgo de suplencia aunque esté disponible." });
    }
    const h = p.hist.map((x) => x[1]);
    if (h.length >= 4 && h.slice(-4).every((v, i, a) => i === 0 || v < a[i - 1])) {
      out.push({ lvl: "info", ic: "▼", p, title: `${p.name} lleva 3 días bajando`, text: `Ha perdido ${fmtM(h[h.length - 4] - h[h.length - 1])} desde ${p.hist[p.hist.length - 4][0]}.` });
    } else if (p.inc < 0) {
      out.push({ lvl: "info", ic: "▼", p, title: `${p.name} baja hoy`, text: fmtInc(p.inc).text });
    }
  }
  const order = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => order[a.lvl] - order[b.lvl]);
}

function renderSquad() {
  const players = squadPlayers().sort((a, b) => ["POR", "DEF", "MED", "DEL", "ENT"].indexOf(a.pos) - ["POR", "DEF", "MED", "DEL", "ENT"].indexOf(b.pos) || pts(b) - pts(a));
  $("#squad-count").textContent = players.length;
  if (!players.length) {
    $("#squad-summary").innerHTML = "";
    $("#squad-alerts").innerHTML = "";
    $("#squad-list").innerHTML = `<p class="empty">Añade a tus jugadores con el buscador de arriba o con el botón + de la pestaña Jugadores.</p>`;
    return;
  }
  const value = players.reduce((a, p) => a + (p.price || 0), 0);
  const change = players.reduce((a, p) => a + (p.inc || 0), 0);
  const total = players.reduce((a, p) => a + pts(p), 0);
  const alerts = alertsFor(players);
  const ch = fmtInc(change);
  $("#squad-summary").innerHTML = `
    <div class="tile"><div class="k">Valor de la plantilla</div><div class="n">${fmtM(value)}</div></div>
    <div class="tile"><div class="k">Variación hoy</div><div class="n ${ch.cls}">${ch.text}</div></div>
    <div class="tile"><div class="k">Puntos totales</div><div class="n">${total}</div></div>
    <div class="tile"><div class="k">Alertas</div><div class="n">${alerts.filter((a) => a.lvl !== "info").length}</div></div>`;
  $("#squad-alerts").innerHTML = alerts.length
    ? `<h2>Alertas</h2><div class="alerts">` + alerts.map((a) => `<div class="alert ${a.lvl}"><span class="ic" aria-hidden="true">${a.ic}</span><div><strong>${esc(a.title)}</strong>${a.text ? `<small>${esc(a.text)}</small>` : ""}</div></div>`).join("") + `</div>`
    : `<h2>Alertas</h2><p class="hint">Sin alertas: todos disponibles y sin bajadas.</p>`;
  $("#squad-list").innerHTML = `<h2>Jugadores (${players.length})</h2>` + players.map(row).join("");
}

function renderSuggest() {
  const q = norm($("#squad-q").value);
  const box = $("#squad-suggest");
  if (q.length < 2) { box.hidden = true; return; }
  const hits = state.data.players.filter((p) => norm(p.name).includes(q) || norm(teamName(p.team)).includes(q)).sort(SORTS.pts).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map((p) => `<button data-toggle="${p.id}" data-from-suggest="1"><span><span class="pos">${esc(p.pos)}</span> ${esc(p.name)} <span class="team">· ${esc(teamName(p.team))}</span></span><span>${state.squad.has(p.id) ? "✓ en plantilla" : fmtM(p.price)}</span></button>`).join("")
    : `<p class="empty" style="padding:12px">Sin resultados</p>`;
  box.hidden = false;
}

// --- Ficha de jugador ---
function priceChart(hist) {
  if (hist.length < 2) return `<p class="hint">El histórico de precios se irá llenando con cada día de datos (hay ${hist.length}).</p>`;
  const W = 520, H = 140, L = 44, R = 8, T = 8, B = 20;
  const vals = hist.map((h) => h[1]);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1e5; max += 1e5; }
  const x = (i) => L + (i / (hist.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  const ticks = [min, (min + max) / 2, max];
  const path = hist.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h[1]).toFixed(1)}`).join("");
  return `<div class="chart" data-hist='${esc(JSON.stringify(hist))}'>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolución del precio">
      ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 3}" text-anchor="end">${(t / 1e6).toFixed(1)}M</text>`).join("")}
      <text class="axis" x="${L}" y="${H - 4}">${esc(hist[0][0].slice(5))}</text>
      <text class="axis" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(hist[hist.length - 1][0].slice(5))}</text>
      <path class="line" d="${path}"/>
      <line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
      <circle class="pt" r="4" visibility="hidden"/>
      <rect x="${L}" y="0" width="${W - L - R}" height="${H}" fill="transparent" class="hit"/>
    </svg>
    <div class="tip" hidden></div>
  </div>`;
}

function bindChart(root) {
  const el = root.querySelector(".chart[data-hist]");
  if (!el) return;
  const hist = JSON.parse(el.dataset.hist);
  const svg = el.querySelector("svg"), tip = el.querySelector(".tip");
  const cross = svg.querySelector(".cross"), pt = svg.querySelector(".pt");
  const vb = svg.viewBox.baseVal, L = 44, R = 8, T = 8, B = 20;
  const vals = hist.map((h) => h[1]);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 1e5; max += 1e5; }
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * vb.width;
    const i = Math.max(0, Math.min(hist.length - 1, Math.round(((px - L) / (vb.width - L - R)) * (hist.length - 1))));
    const cx = L + (i / (hist.length - 1)) * (vb.width - L - R);
    const cy = T + (1 - (hist[i][1] - min) / (max - min)) * (vb.height - T - B);
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
    pt.setAttribute("cx", cx); pt.setAttribute("cy", cy); pt.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.textContent = `${hist[i][0]} · ${fmtM(hist[i][1])}`;
    tip.style.left = `${(cx / vb.width) * r.width}px`;
    tip.style.top = `${(cy / vb.height) * r.height}px`;
  };
  const leave = () => { cross.setAttribute("visibility", "hidden"); pt.setAttribute("visibility", "hidden"); tip.hidden = true; };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", leave);
}

function openPlayer(id) {
  const p = state.byId.get(id);
  if (!p) return;
  const inSquad = state.squad.has(p.id);
  const inc = fmtInc(p.inc);
  const nx = state.data.teams[p.team]?.next;
  const rows = state.data.scores.map((s) => {
    const v = p.scores[s.id];
    if (!v) return "";
    const a = p.played ? (v.pts / p.played).toLocaleString("es-ES", { maximumFractionDigits: 1 }) : "—";
    return `<tr class="${String(s.id) === state.score ? "sel" : ""}"><td>${esc(s.name)}</td><td>${v.pts ?? "—"}</td><td>${a}</td></tr>`;
  }).join("");
  $("#player-detail").innerHTML = `<div class="detail">
    <header>
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="team">${esc(p.pos)}${p.alt.length ? " / " + esc(p.alt.join(", ")) : ""} · ${esc(teamName(p.team))}</div>
      </div>
      <button class="close" data-close aria-label="Cerrar">×</button>
    </header>
    <div class="meta" style="margin-top:10px">${statusBadge(p)} ${nx ? `Próximo: ${nx.home ? "vs" : "en"} ${esc(teamName(nx.opp))}${nx.date ? " · " + esc(fmtDate(nx.date)) : ""}` : ""}</div>
    ${p.info ? `<div class="info">${esc(p.info)}${p.since ? `<br><small>Desde el ${esc(fmtDate(p.since))}</small>` : ""}</div>` : ""}
    <div class="kv">
      <div class="tile"><div class="k">Precio</div><div class="n" style="font-size:18px">${fmtM(p.price)}</div><div class="${inc.cls}" style="font-size:12px">${inc.text} hoy</div></div>
      <div class="tile"><div class="k">Puntos</div><div class="n" style="font-size:18px">${pts(p)}</div><div style="font-size:12px;color:var(--text-3)">${p.played} partidos</div></div>
      <div class="tile"><div class="k">Temp. pasada</div><div class="n" style="font-size:18px">${p.lastSeason ?? "—"}</div><div style="font-size:12px;color:var(--text-3)">puntos</div></div>
    </div>
    <h2>Últimas jornadas</h2>
    ${formBoxes(p).replace('class="form"', 'class="form" style="justify-content:flex-start"')}
    <h2>Precio</h2>
    ${priceChart(p.hist)}
    <h2>Puntos por sistema de puntuación</h2>
    <table class="pts"><thead><tr><th>Sistema</th><th>Puntos</th><th>Media</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:16px"><button class="more" style="margin:0" data-toggle="${p.id}">${inSquad ? "Quitar de mi plantilla" : "Añadir a mi plantilla"}</button></p>
  </div>`;
  bindChart($("#player-detail"));
  const dlg = $("#player-dialog");
  if (!dlg.open) dlg.showModal();
}

// --- Control general ---
function toggleSquad(id) {
  if (state.squad.has(id)) state.squad.delete(id); else state.squad.add(id);
  store.set("squad", [...state.squad]);
}

function render() {
  $("#tab-players").hidden = state.tab !== "players";
  $("#tab-squad").hidden = state.tab !== "squad";
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  if (state.tab === "players") renderPlayers();
  renderSquad();
}

function bind() {
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    state.tab = b.dataset.tab; store.set("tab", state.tab); render();
  }));
  $("#q").addEventListener("input", (e) => { state.q = e.target.value; state.shown = PAGE; renderPlayers(); });
  $("#team").addEventListener("change", (e) => { state.team = e.target.value; state.shown = PAGE; renderPlayers(); });
  $("#status").addEventListener("change", (e) => { state.status = e.target.value; state.shown = PAGE; renderPlayers(); });
  $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; renderPlayers(); });
  $("#score").addEventListener("change", (e) => { state.score = e.target.value; store.set("score", state.score); render(); });
  $("#more").addEventListener("click", () => { state.shown += PAGE; renderPlayers(); });
  $("#pos-chips").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.pos = b.dataset.pos; state.shown = PAGE;
    document.querySelectorAll("#pos-chips button").forEach((x) => x.classList.toggle("on", x === b));
    renderPlayers();
  });
  $("#squad-q").addEventListener("input", renderSuggest);
  $("#squad-q").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; renderSuggest(); } });

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle]");
    if (t) {
      toggleSquad(Number(t.dataset.toggle));
      render();
      if (t.dataset.fromSuggest) { $("#squad-q").value = ""; renderSuggest(); $("#squad-q").focus(); }
      if ($("#player-dialog").open) openPlayer(Number(t.dataset.toggle));
      return;
    }
    const o = e.target.closest("[data-open]");
    if (o) { openPlayer(Number(o.dataset.open)); return; }
    if (e.target.closest("[data-close]") || e.target === $("#player-dialog")) $("#player-dialog").close();
    if (!e.target.closest(".squad-add")) $("#squad-suggest").hidden = true;
  });
}

async function init() {
  bind();
  try {
    const res = await fetch(`data/${COMPETITION}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    state.data = await res.json();
  } catch (err) {
    $("#meta").textContent = "No se pudieron cargar los datos.";
    $("#players-list").innerHTML = `<p class="empty">No se pudieron cargar los datos (${esc(err.message)}).</p>`;
    return;
  }
  const d = state.data;
  d.players.forEach((p) => state.byId.set(p.id, p));
  if (!d.scores.some((s) => String(s.id) === state.score)) state.score = String(d.scores[0]?.id ?? "1");
  $("#score").innerHTML = d.scores.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  $("#score").value = state.score;
  $("#team").innerHTML += Object.entries(d.teams).sort((a, b) => a[1].name.localeCompare(b[1].name, "es"))
    .map(([id, t]) => `<option value="${id}">${esc(t.name)}</option>`).join("");
  const updated = new Date(d.updated + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long" });
  $("#meta").textContent = `${d.season ?? ""} · Datos del ${updated}${d.nextRound ? " · Próxima: " + d.nextRound.name : ""} · No oficial`;
  state.tab = store.get("tab", "players");
  render();
}

init();
