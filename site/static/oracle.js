"use strict";
(function () {
  const { $, esc, squad, getScore, store } = BF;

  function md(text) {
    // Formato mínimo y seguro: escapamos todo y luego permitimos **negrita** y viñetas.
    return esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/^[-•] /gm, "• ");
  }

  async function ask(e) {
    e.preventDefault();
    const q = $("#or-q").value.trim();
    const box = $("#or-answer");
    if (q.length < 3) { $("#or-q").focus(); return; }
    $("#or-go").disabled = true;
    box.innerHTML = `<section class="result"><p class="loading">🔮 El oráculo está pensando…</p></section>`;
    try {
      const res = await fetch("/api/oraculo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, squad: $("#or-squad").checked ? [...squad] : [], score: getScore() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.answer) {
        box.innerHTML = `<section class="result"><p class="hint" style="margin-top:0">${esc(q)}</p><div class="answer">${md(data.answer)}</div></section>`;
        store.set("oracle-last", { q, a: data.answer });
        window.va?.("event", { name: "oraculo" });
      } else if (data.error === "not_configured" || res.status === 404) {
        box.innerHTML = `<div class="info">El oráculo con IA se activará muy pronto. Mientras tanto, el <a href="/consultorio/">consultorio</a> compara jugadores y te recomienda fichajes al momento.</div>`;
      } else {
        box.innerHTML = `<div class="info">${esc(data.message || "No hemos podido responder. Inténtalo de nuevo.")}</div>`;
      }
    } catch {
      box.innerHTML = `<div class="info">Sin conexión con el oráculo. Revisa tu conexión e inténtalo de nuevo.</div>`;
    } finally {
      $("#or-go").disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#or-count").textContent = squad.size;
    if (!squad.size) { $("#or-squad").checked = false; }
    $("#or-form").addEventListener("submit", ask);
    $(".or-examples").addEventListener("click", (e) => {
      const b = e.target.closest("[data-example]"); if (!b) return;
      $("#or-q").value = b.dataset.example; $("#or-q").focus();
    });
    const last = store.get("oracle-last", null);
    if (last) $("#or-answer").innerHTML = `<section class="result"><p class="hint" style="margin-top:0">Tu última pregunta: ${esc(last.q)}</p><div class="answer">${md(last.a)}</div></section>`;
  });
})();
