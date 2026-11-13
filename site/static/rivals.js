"use strict";
(function () {
  const { $, esc, fmtM, parseM, store, toast } = BF;
  const TYPES = {
    compra: { label: "Compra", sign: -1 },
    venta: { label: "Venta", sign: 1 },
    "clausula-pagada": { label: "Pagó una cláusula", sign: -1 },
    "clausula-recibida": { label: "Le pagaron una cláusula", sign: 1 },
    premio: { label: "Premio de jornada", sign: 1 },
    otro: { label: "Otro ajuste (+/−)", sign: 0 },
  };
  const state = store.get("rivals", { debt: 0, list: [] });
  const save = () => store.set("rivals", state);
  const saldo = (r) => r.moves.reduce((a, m) => a + m.amount, 0);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const today = () => new Date().toISOString().slice(0, 10);

  function renderWho() {
    const amount = parseM($("#r-amount").value);
    const debt = parseM($("#r-debt").value) ?? 0;
    const box = $("#r-who");
    if (!state.list.length) { box.innerHTML = `<p class="hint">Añade a tus rivales abajo para saberlo.</p>`; return; }
    if (amount == null) { box.innerHTML = `<p class="hint">Escribe un importe, por ejemplo la cláusula de tu mejor jugador.</p>`; return; }
    const can = state.list.filter((r) => saldo(r) + debt >= amount).sort((a, b) => saldo(b) - saldo(a));
    box.innerHTML = can.length
      ? `<p class="verdict" style="font-size:16px">${can.length} de ${state.list.length} rivales pueden pagar ${fmtM(amount)}</p><ul class="who-can">${can.map((r) => `<li><strong>${esc(r.name)}</strong> · saldo ${fmtM(saldo(r))} (le sobrarían ${fmtM(saldo(r) + debt - amount)})</li>`).join("")}</ul>`
      : `<p class="verdict" style="font-size:16px">Nadie puede pagar ${fmtM(amount)} ahora mismo</p>`;
  }

  function render() {
    $("#r-debt").value = state.debt ? String(state.debt / 1e6).replace(".", ",") : "0";
    const opts = Object.entries(TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("");
    $("#r-list").innerHTML = state.list.length ? state.list.slice().sort((a, b) => saldo(b) - saldo(a)).map((r) => `
      <section class="rival" data-r="${r.id}">
        <div class="rival-head"><h3>${esc(r.name)}</h3><div><span class="saldo ${saldo(r) < 0 ? "down" : ""}">${fmtM(saldo(r))}</span>
          <button class="linkbtn" data-del-rival="${r.id}" aria-label="Eliminar a ${esc(r.name)}" title="Eliminar rival">✕</button></div></div>
        <form class="move-form" data-move="${r.id}">
          <select name="t" aria-label="Tipo de movimiento">${opts}</select>
          <input name="a" type="text" step="0.01" inputmode="decimal" placeholder="Importe (M €)" aria-label="Importe" required>
          <input name="n" type="text" placeholder="Jugador o nota (opcional)" aria-label="Nota">
          <button class="btn" type="submit">Añadir</button>
        </form>
        <ul class="moves">${r.moves.slice().reverse().slice(0, 8).map((m) => `<li><span>${esc(m.date)} · ${esc(TYPES[m.type]?.label || m.type)}${m.note ? " · " + esc(m.note) : ""}</span><span><span class="${m.amount < 0 ? "down" : "up"}">${m.amount < 0 ? "−" : "+"}${fmtM(Math.abs(m.amount))}</span><button data-del-move="${r.id}:${m.id}" aria-label="Borrar movimiento">✕</button></span></li>`).join("")}</ul>
        ${r.moves.length > 8 ? `<p class="hint">y ${r.moves.length - 8} movimientos más antiguos</p>` : ""}
      </section>`).join("")
      : `<div class="card"><p class="hint" style="margin:0">Aún no has añadido rivales. Pon su nombre y el saldo que tienen ahora (lo ves en la clasificación de tu liga o lo calculas desde el inicio).</p></div>`;
    renderWho();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#r-add").addEventListener("click", () => {
      const name = $("#r-new").value.trim();
      if (!name) { $("#r-new").focus(); return; }
      const s = parseM($("#r-new-saldo").value) ?? 0;
      state.list.push({ id: uid(), name, moves: [{ id: uid(), type: "otro", amount: s, note: "Saldo inicial", date: today() }] });
      $("#r-new").value = ""; $("#r-new-saldo").value = "";
      save(); render();
    });
    $("#r-list").addEventListener("submit", (e) => {
      const f = e.target.closest("[data-move]"); if (!f) return;
      e.preventDefault();
      const r = state.list.find((x) => x.id === f.dataset.move);
      const t = f.t.value, v = parseM(f.a.value);
      if (!r || v == null) return;
      const amount = TYPES[t].sign === 0 ? v : TYPES[t].sign * Math.abs(v);
      r.moves.push({ id: uid(), type: t, amount, note: f.n.value.trim(), date: today() });
      save(); render();
    });
    $("#r-list").addEventListener("click", (e) => {
      const dr = e.target.closest("[data-del-rival]");
      if (dr) {
        const r = state.list.find((x) => x.id === dr.dataset.delRival);
        if (r && confirm(`¿Eliminar a ${r.name} y todos sus movimientos?`)) { state.list = state.list.filter((x) => x !== r); save(); render(); }
        return;
      }
      const dm = e.target.closest("[data-del-move]");
      if (dm) {
        const [rid, mid] = dm.dataset.delMove.split(":");
        const r = state.list.find((x) => x.id === rid);
        if (r) { r.moves = r.moves.filter((m) => m.id !== mid); save(); render(); }
      }
    });
    $("#r-amount").addEventListener("input", renderWho);
    $("#r-debt").addEventListener("input", () => { state.debt = parseM($("#r-debt").value) ?? 0; save(); renderWho(); });
    $("#r-export").addEventListener("click", () => {
      const io = $("#r-io"); io.hidden = false; io.value = JSON.stringify(state); io.select();
      try { navigator.clipboard.writeText(io.value); toast("Copia copiada al portapapeles"); } catch { /* el usuario puede copiarla a mano */ }
    });
    $("#r-import").addEventListener("click", () => {
      const io = $("#r-io");
      if (io.hidden || !io.value.trim()) { io.hidden = false; io.value = ""; io.placeholder = "Pega aquí tu copia y vuelve a pulsar Importar"; io.focus(); return; }
      try {
        const d = JSON.parse(io.value);
        if (!Array.isArray(d.list)) throw new Error("formato");
        state.debt = d.debt || 0; state.list = d.list; save(); render(); io.hidden = true; toast("Copia importada");
      } catch { toast("La copia no es válida"); }
    });
    render();
  });
})();
