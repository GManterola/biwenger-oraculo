"use strict";
/* Bifantasy Oráculo: utilidades comunes a todas las páginas. */
(function () {
  const COMPETITION = "la-liga";
  const STATUS = {
    ok: "Disponible", doubt: "Duda", warned: "Apercibido",
    injured: "Lesionado", sanctioned: "Sancionado", discarded: "Descartado",
  };
  const POS_ORDER = ["POR", "DEF", "MED", "DEL", "ENT"];

  const store = {
    get(k, f) { try { const v = localStorage.getItem(k); return v === null ? f : JSON.parse(v); } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const num = (v, d = 1) => Number(v ?? 0).toLocaleString("es-ES", { maximumFractionDigits: d });
  const fmtM = (v) => v == null ? "—" : (v / 1e6).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " M";
  function fmtInc(v) {
    if (!v) return { text: "=", cls: "flat" };
    const a = Math.abs(v);
    const t = a >= 1e6 ? (a / 1e6).toLocaleString("es-ES", { maximumFractionDigits: 2 }) + " M" : Math.round(a / 1e3).toLocaleString("es-ES") + " k";
    return { text: (v > 0 ? "▲ +" : "▼ −") + t, cls: v > 0 ? "up" : "down" };
  }
  const pct = (x) => x == null ? "—" : Math.round(x * 100) + " %";
  const pctClass = (x) => x == null ? "" : x >= 0.75 ? "hi" : x >= 0.45 ? "mid" : "low";
  const parseM = (s) => { const v = parseFloat(String(s ?? "").replace(",", ".")); return Number.isFinite(v) ? v * 1e6 : null; };

  // --- Datos ---
  let dataPromise = null;
  const byId = new Map();
  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch(`/data/${COMPETITION}.json`).then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then((d) => { d.players.forEach((p) => byId.set(p.id, p)); BF.data = d; return d; });
    }
    return dataPromise;
  }

  // --- Sistema de puntuación ---
  function getScore() { return String(store.get("score", BF.data?.primaryScore ?? 1)); }
  function setScore(s) { store.set("score", String(s)); document.dispatchEvent(new CustomEvent("bf:score")); }
  const sc = (p) => p.scores[getScore()] || p.scores[String(BF.data?.primaryScore ?? 1)] || { pts: 0, fit: [], avg: 0, xp: 0 };
  const teamName = (id) => BF.data?.teams[id]?.name ?? "—";
  const teamSlug = (id) => BF.data?.teams[id]?.slug ?? "";

  // --- Plantilla (solo en este navegador) ---
  const squad = new Set(store.get("squad", []));
  function toggleSquad(id) {
    const had = squad.has(id);
    if (had) squad.delete(id); else squad.add(id);
    store.set("squad", [...squad]);
    syncToggles();
    document.dispatchEvent(new CustomEvent("bf:squad"));
    if (!had) toast(`Añadido a tu plantilla (${squad.size})`, "/plantilla/", "Ver plantilla");
    else toast("Quitado de tu plantilla");
  }
  function syncToggles() {
    $$("[data-toggle]").forEach((b) => {
      const inS = squad.has(Number(b.dataset.toggle));
      if (b.classList.contains("add")) {
        b.classList.toggle("in", inS);
        b.textContent = inS ? "✓" : "+";
        b.setAttribute("aria-label", inS ? "Quitar de mi plantilla" : "Añadir a mi plantilla");
        b.title = b.getAttribute("aria-label");
      } else if (b.classList.contains("btn")) {
        b.textContent = inS ? "✓ En mi plantilla" : "Añadir a mi plantilla";
      }
    });
  }
  let toastTimer;
  function toast(msg, href, label) {
    let t = $(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.innerHTML = esc(msg) + (href && location.pathname !== href ? `<a href="${href}">${esc(label)}</a>` : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // --- Piezas de interfaz (mismo marcado que el HTML generado) ---
  function statusBadge(p) {
    return `<span class="st st-${esc(p.status)}"><span class="dot" aria-hidden="true"></span>${esc(STATUS[p.status] || p.status)}</span>`;
  }
  function formBoxes(fit) {
    if (!fit || !fit.length) return "";
    const ch = [...fit].reverse(), n = ch.length;
    return `<span class="form" aria-label="Últimas ${n} jornadas">` + ch.map((x, i) => {
      const when = i === n - 1 ? "Última jornada" : `Hace ${n - 1 - i} jornadas`;
      if (typeof x === "number") {
        const c = x >= 8 ? "hi" : x >= 4 ? "mid" : x < 0 ? "neg" : "";
        return `<span class="fb ${c}" title="${when}: ${x} puntos">${x}</span>`;
      }
      const label = x == null ? "No jugó" : (STATUS[x] || x);
      const short = x == null ? "–" : ({ injured: "L", sanctioned: "S", doubt: "D" }[x] || "·");
      return `<span class="fb out" title="${when}: ${esc(label)}">${short}</span>`;
    }).join("") + `</span>`;
  }
  function nextGame(p) {
    const nx = BF.data?.teams[p.team]?.next;
    if (!nx) return "";
    return `<span class="next">${nx.home ? "vs" : "en"} <a href="/equipo/${esc(teamSlug(nx.opp))}/">${esc(teamName(nx.opp))}</a></span>`;
  }
  function probsHTML(p) {
    const s = sc(p);
    const pp = p.pPlay;
    return `<div class="probs">${pp != null ? `<span class="prob ${pctClass(pp)}" title="Probabilidad de jugar">${pct(pp)}<small>juega</small></span>` : ""}
      <span class="stats"><b>${s.pts ?? 0}</b> pts · media <b>${num(s.avg)}</b></span></div>`;
  }
  function rowHTML(p, extra = "") {
    const inc = fmtInc(p.inc), inS = squad.has(p.id);
    return `<article class="row" data-id="${p.id}">
      <div class="who"><span class="pos">${esc(p.pos)}</span><div class="who-t">
        <a class="name" href="/jugador/${esc(p.slug)}/">${esc(p.name)}</a><div class="team">${esc(teamName(p.team))}</div></div></div>
      <div class="meta">${statusBadge(p)} ${nextGame(p)}</div>
      ${probsHTML(p)}
      ${formBoxes(sc(p).fit)}
      <div class="price"><div><span class="v">${fmtM(p.price)}</span><span class="d ${inc.cls}">${inc.text}</span></div>
        <button class="add ${inS ? "in" : ""}" data-toggle="${p.id}" aria-label="${inS ? "Quitar de" : "Añadir a"} mi plantilla">${inS ? "✓" : "+"}</button></div>
      ${extra}
    </article>`;
  }

  // Reescribe puntos y forma de las filas generadas en el servidor si el sistema elegido no es el principal.
  function patchStaticRows() {
    const rows = $$(".row[data-id]");
    if (!rows.length || !BF.data) return;
    rows.forEach((r) => {
      const p = byId.get(Number(r.dataset.id));
      if (!p) return;
      const probs = $(".probs", r), form = $(".form", r);
      if (probs) probs.outerHTML = probsHTML(p);
      const f = formBoxes(sc(p).fit);
      if (form && f) form.outerHTML = f;
    });
  }

  // --- Buscador con sugerencias ---
  function attachSuggest(input, box, onPick, { filter = () => true, right } = {}) {
    let hits = [];
    const render = () => {
      const q = norm(input.value);
      if (q.length < 2 || !BF.data) { box.hidden = true; return; }
      hits = BF.data.players.filter((p) => filter(p) && (norm(p.name).includes(q) || norm(teamName(p.team)).includes(q)))
        .sort((a, b) => (norm(b.name).startsWith(q) - norm(a.name).startsWith(q)) || (b.price - a.price)).slice(0, 8);
      box.innerHTML = hits.length ? hits.map((p) => `<button type="button" data-pick="${p.id}"><span><span class="pos">${esc(p.pos)}</span> ${esc(p.name)} <span class="team">· ${esc(teamName(p.team))}</span></span><span>${right ? right(p) : fmtM(p.price)}</span></button>`).join("")
        : `<p class="empty" style="padding:12px;margin:0">Sin resultados</p>`;
      box.hidden = false;
    };
    input.addEventListener("input", render);
    input.addEventListener("focus", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { input.value = ""; box.hidden = true; }
      if (e.key === "Enter" && hits[0]) { e.preventDefault(); onPick(hits[0]); input.value = ""; box.hidden = true; }
      if (e.key === "ArrowDown") { e.preventDefault(); box.querySelector("button")?.focus(); }
    });
    box.addEventListener("keydown", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (e.key === "ArrowDown") { e.preventDefault(); (b.nextElementSibling || b).focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); (b.previousElementSibling || input).focus(); }
    });
    box.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pick]"); if (!b) return;
      onPick(byId.get(Number(b.dataset.pick)));
      input.value = ""; box.hidden = true; input.focus();
    });
    document.addEventListener("click", (e) => { if (!box.contains(e.target) && e.target !== input) box.hidden = true; });
  }

  // --- Gráfica de precio: tooltip con cruceta ---
  function bindCharts() {
    $$(".chart[data-hist]").forEach((el) => {
      const hist = JSON.parse(el.dataset.hist);
      const svg = $("svg", el), tip = $(".tip", el), cross = $(".cross", svg), pt = $(".pt", svg);
      const vb = svg.viewBox.baseVal, L = 46, R = 8, T = 10, B = 22;
      const vals = hist.map((h) => h[1]);
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (lo === hi) { lo -= 1e5; hi += 1e5; }
      const move = (ev) => {
        const r = svg.getBoundingClientRect();
        const px = ((ev.clientX - r.left) / r.width) * vb.width;
        const i = Math.max(0, Math.min(hist.length - 1, Math.round(((px - L) / (vb.width - L - R)) * (hist.length - 1))));
        const cx = L + (i / (hist.length - 1)) * (vb.width - L - R);
        const cy = T + (1 - (hist[i][1] - lo) / (hi - lo)) * (vb.height - T - B);
        cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
        pt.setAttribute("cx", cx); pt.setAttribute("cy", cy); pt.setAttribute("visibility", "visible");
        tip.hidden = false; tip.textContent = `${hist[i][0]} · ${fmtM(hist[i][1])}`;
        tip.style.left = `${10 + (cx / vb.width) * r.width}px`; tip.style.top = `${10 + (cy / vb.height) * r.height}px`;
      };
      svg.addEventListener("pointermove", move);
      svg.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); pt.setAttribute("visibility", "hidden"); tip.hidden = true; });
    });
  }

  // --- Compartir (menú nativo del móvil o copiar al portapapeles) ---
  async function share({ title, text, url }) {
    const full = url || location.href;
    try {
      if (navigator.share) { await navigator.share({ title, text, url: full }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(`${text}\n${full}`); toast("Copiado: pégalo donde quieras"); }
    catch { prompt("Copia este texto:", `${text}\n${full}`); }
    window.va?.("event", { name: "compartir" });
  }

  const BF = window.BF = {
    data: null, store, $, $$, esc, norm, num, fmtM, fmtInc, pct, pctClass, parseM, STATUS, POS_ORDER,
    loadData, byId, getScore, setScore, sc, teamName, teamSlug, squad, toggleSquad, syncToggles, toast,
    statusBadge, formBoxes, nextGame, rowHTML, attachSuggest, share,
  };

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle]");
    if (t) { e.preventDefault(); toggleSquad(Number(t.dataset.toggle)); return; }
    const sh = e.target.closest("[data-share]");
    if (sh) { e.preventDefault(); share({ title: document.title, text: sh.dataset.share }); }
  });

  document.addEventListener("DOMContentLoaded", () => {
    syncToggles();
    bindCharts();
    const sel = $("#score-select");
    loadData().then((d) => {
      if (sel) {
        if (!d.scores.some((s) => String(s.id) === getScore())) store.set("score", String(d.primaryScore));
        sel.value = getScore();
        sel.addEventListener("change", () => setScore(sel.value));
      }
      if (getScore() !== String(d.primaryScore)) patchStaticRows();
      document.addEventListener("bf:score", patchStaticRows);
      document.dispatchEvent(new CustomEvent("bf:ready"));
    }).catch((err) => {
      console.warn("No se pudieron cargar los datos", err);
      $$("[data-needs-data]").forEach((el) => { el.innerHTML = `<p class="empty">No se pudieron cargar los datos. Recarga la página.</p>`; });
    });
  });
})();
