"use strict";
(function () {
  const { $, $$, norm, sc, teamName, rowHTML, store, syncToggles } = BF;
  const PAGE = 50;
  const st = { q: "", pos: "", team: "", status: "", sort: store.get("players-sort", "pts"), maxp: null, shown: PAGE };
  const formSum = (p) => (sc(p).fit || []).reduce((a, x) => a + (typeof x === "number" ? x : 0), 0);
  const SORTS = {
    pts: (a, b) => (sc(b).pts ?? 0) - (sc(a).pts ?? 0),
    xp: (a, b) => (sc(b).xp ?? 0) - (sc(a).xp ?? 0),
    pplay: (a, b) => (b.pPlay ?? -1) - (a.pPlay ?? -1) || (sc(b).pts ?? 0) - (sc(a).pts ?? 0),
    avg: (a, b) => (sc(b).avg ?? 0) - (sc(a).avg ?? 0),
    form: (a, b) => formSum(b) - formSum(a),
    value: (a, b) => (sc(b).vi ?? 0) - (sc(a).vi ?? 0),
    inc: (a, b) => (b.inc ?? 0) - (a.inc ?? 0),
    dec: (a, b) => (a.inc ?? 0) - (b.inc ?? 0),
    price: (a, b) => (b.price ?? 0) - (a.price ?? 0),
    cheap: (a, b) => (a.price ?? 0) - (b.price ?? 0),
  };

  function list() {
    const q = norm(st.q);
    return BF.data.players.filter((p) =>
      (!st.pos ? p.pos !== "ENT" : p.pos === st.pos || p.alt.includes(st.pos)) &&
      (!st.team || String(p.team) === st.team) &&
      (!st.status || p.status === st.status) &&
      (!st.maxp || (p.price ?? 0) <= st.maxp) &&
      (!q || norm(p.name).includes(q) || norm(teamName(p.team)).includes(q))
    ).sort(SORTS[st.sort] || SORTS.pts);
  }

  function render() {
    const items = list();
    $("#players-list").innerHTML = items.length ? items.slice(0, st.shown).map((p) => rowHTML(p)).join("")
      : `<p class="empty">No hay jugadores con esos filtros.</p>`;
    const more = $("#more");
    more.hidden = items.length <= st.shown;
    more.textContent = `Mostrar más (${items.length - st.shown} restantes)`;
    syncToggles();
  }

  BF.loadData().then(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("q")) { st.q = params.get("q"); $("#q").value = st.q; }
    $("#sort").value = st.sort;
    $("#q").addEventListener("input", (e) => { st.q = e.target.value; st.shown = PAGE; render(); });
    $("#team").addEventListener("change", (e) => { st.team = e.target.value; st.shown = PAGE; render(); });
    $("#status").addEventListener("change", (e) => { st.status = e.target.value; st.shown = PAGE; render(); });
    $("#sort").addEventListener("change", (e) => { st.sort = e.target.value; store.set("players-sort", st.sort); render(); });
    $("#maxp").addEventListener("input", (e) => { st.maxp = BF.parseM(e.target.value); st.shown = PAGE; render(); });
    $("#more").addEventListener("click", () => { st.shown += PAGE; render(); });
    $("#pos-chips").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      st.pos = b.dataset.pos; st.shown = PAGE;
      $$("#pos-chips button").forEach((x) => x.classList.toggle("on", x === b));
      render();
    });
    document.addEventListener("bf:score", render);
    render();
  });
})();
