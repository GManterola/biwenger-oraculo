"""Genera la web estática de Bifantasy Oráculo en web/.

Lee las descargas de data/raw, calcula el modelo (site/model.py) y escribe:
- web/data/<competicion>.json   datos para las herramientas interactivas
- páginas HTML: portada, jugadores, mercado, bajas, plantilla, puja,
  consultorio, rivales, liga, legales, una por jugador y una por equipo
- sitemap.xml, robots.txt, 404.html y los archivos de site/static

Uso:
    python site/build.py [--competition la-liga] [--site-url https://...]
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import html
import json
import os
import shutil
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from model import enrich  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
STATIC_DIR = ROOT / "site" / "static"
OUT = ROOT / "web"
SITE_NAME = "Bifantasy Oráculo"
DEFAULT_URL = os.environ.get("SITE_URL", "https://bifantasy-oraculo.vercel.app")
POSITIONS = {1: "POR", 2: "DEF", 3: "MED", 4: "DEL", 5: "ENT"}
POS_NAME = {"POR": "Porteros", "DEF": "Defensas", "MED": "Centrocampistas", "DEL": "Delanteros", "ENT": "Entrenador"}
PRIMARY_SCORE = 1
HISTORY_DAYS = 60
# Código de invitación de la liga oficial cuando exista (None = "próximamente").
LEAGUE = {"code": None, "url": None}

STATUS = {
    "ok": ("Disponible", "ok"),
    "doubt": ("Duda", "doubt"),
    "warned": ("Apercibido", "warned"),
    "injured": ("Lesionado", "injured"),
    "sanctioned": ("Sancionado", "sanctioned"),
    "discarded": ("Descartado", "discarded"),
}
MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
          "septiembre", "octubre", "noviembre", "diciembre"]

e = html.escape


# ---------------------------------------------------------------- datos

def load(path: Path) -> dict:
    return json.loads(gzip.decompress(path.read_bytes()))["data"]


def collect(competition: str) -> dict:
    comp_dir = RAW_DIR / competition
    by_day: dict[str, dict[int, Path]] = defaultdict(dict)
    for f in sorted(comp_dir.glob("*_score*.json.gz")):
        day, score = f.name.removesuffix(".json.gz").split("_score")
        by_day[day][int(score)] = f
    if not by_day:
        raise SystemExit(f"No hay descargas en {comp_dir}")
    days = sorted(by_day)
    latest_day = days[-1]
    latest = by_day[latest_day]
    primary = PRIMARY_SCORE if PRIMARY_SCORE in latest else min(latest)
    base = load(latest[primary])

    history: dict[int, list[list]] = defaultdict(list)
    for day in days[-HISTORY_DAYS:]:
        f = by_day[day].get(primary) or next(iter(by_day[day].values()))
        for p in load(f)["players"].values():
            history[p["id"]].append([day, p.get("price")])

    per_score = {s: {p["id"]: p for p in load(f)["players"].values()} for s, f in latest.items()}

    teams = {}
    for t in base["teams"].values():
        nxt = None
        for g in t.get("nextGames") or []:
            is_home = g["home"]["id"] == t["id"]
            nxt = {"opp": g["away"]["id"] if is_home else g["home"]["id"], "home": is_home,
                   "date": g.get("date"), "round": (g.get("round") or {}).get("id")}
            break
        teams[t["id"]] = {"name": t["name"], "slug": t.get("slug"), "next": nxt}

    players = []
    for p in base["players"].values():
        pid = p["id"]
        info = p.get("statusInfo")
        players.append({
            "id": pid, "name": p["name"], "slug": p.get("slug") or str(pid), "team": p.get("teamID"),
            "pos": POSITIONS.get(p.get("position"), "?"),
            "alt": [POSITIONS.get(a, "?") for a in p.get("altPositions") or []],
            "price": p.get("price"), "inc": p.get("priceIncrement"), "status": p.get("status") or "ok",
            "info": info if isinstance(info, str) else None, "since": p.get("statusChange"),
            "played": (p.get("playedHome") or 0) + (p.get("playedAway") or 0),
            "lastSeason": p.get("pointsLastSeason"),
            "scores": {str(s): {"pts": sp[pid].get("points"), "fit": sp[pid].get("fitness")}
                       for s, sp in per_score.items() if pid in sp},
            "hist": history.get(pid, []),
        })

    rounds = base.get("season", {}).get("rounds", [])
    next_round = next((r for r in rounds if r.get("status") != "finished"), None)
    scores = [{"id": s["id"], "name": s["name"]} for s in base.get("scores", []) if s["id"] in per_score]
    model_meta = enrich(players, teams, str(primary))
    return {
        "competition": competition, "name": base.get("name"), "season": base.get("season", {}).get("name"),
        "updated": latest_day, "days": len(days),
        "nextRound": {"id": next_round["id"], "name": next_round["name"]} if next_round else None,
        "primaryScore": primary, "scores": scores, "teams": teams, "players": players, **model_meta,
    }


# ---------------------------------------------------------------- formato

def fmt_m(v) -> str:
    return "—" if v is None else f"{v / 1e6:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " M"


def fmt_inc(v) -> tuple[str, str]:
    if not v:
        return "=", "flat"
    a = abs(v)
    t = f"{a / 1e6:.2f}".replace(".", ",") + " M" if a >= 1e6 else f"{round(a / 1e3)} k"
    return ("▲ +" if v > 0 else "▼ −") + t, "up" if v > 0 else "down"


def fmt_day(day: str) -> str:
    d = dt.date.fromisoformat(day)
    return f"{d.day} de {MONTHS[d.month - 1]}"


def fmt_ts(ts) -> str:
    if not ts:
        return ""
    d = dt.datetime.fromtimestamp(ts, dt.timezone(dt.timedelta(hours=1)))
    days = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
    return f"{days[d.weekday()]} {d.day} {MONTHS[d.month - 1][:3]} · {d:%H:%M}"


def pct(x) -> str:
    return "—" if x is None else f"{round(x * 100)} %"


def pct_class(x) -> str:
    if x is None:
        return ""
    return "hi" if x >= 0.75 else "mid" if x >= 0.45 else "low"


# ---------------------------------------------------------------- piezas

LOGO = ('<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" '
        'stroke="currentColor" stroke-width="2.5"/><circle cx="16" cy="16" r="6" fill="currentColor"/>'
        '<path d="M16 2v5M16 25v5M2 16h5M25 16h5" stroke="currentColor" stroke-width="2.5" '
        'stroke-linecap="round"/></svg>')

NAV = [
    ("/", "Inicio", "home"),
    ("/plantilla/", "Mi plantilla", "squad"),
    ("/jugadores/", "Jugadores", "players"),
    ("/mercado/", "Mercado", "market"),
    ("/bajas/", "Bajas", "injuries"),
    ("/puja/", "Puja ideal", "bid"),
    ("/consultorio/", "Consultorio", "advisor"),
    ("/rivales/", "Rivales", "rivals"),
]


def page(ctx: dict, *, path: str, title: str, description: str, body: str, active: str = "",
         scripts: tuple[str, ...] = (), jsonld: dict | None = None, noindex: bool = False) -> str:
    url = ctx["url"] + path
    nav = "".join(f'<a href="{h}"{" aria-current=\"page\"" if k == active else ""}>{e(t)}</a>' for h, t, k in NAV)
    js = "".join(f'<script src="/{s}?v={ctx["ver"]}" defer></script>' for s in scripts)
    ld = f'<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>' if jsonld else ""
    full_title = title if SITE_NAME in title else f"{title} | {SITE_NAME}"
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(full_title)}</title>
<meta name="description" content="{e(description)}">
<link rel="canonical" href="{e(url)}">
{'<meta name="robots" content="noindex">' if noindex else ''}
<meta property="og:type" content="website">
<meta property="og:site_name" content="{SITE_NAME}">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(description)}">
<meta property="og:url" content="{e(url)}">
<meta property="og:image" content="{ctx['url']}/og.png">
<meta property="og:locale" content="es_ES">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#1f6fd1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/styles.css?v={ctx['ver']}">
{ld}
<script>window.va=window.va||function(){{(window.vaq=window.vaq||[]).push(arguments)}};</script>
<script defer src="/_vercel/insights/script.js"></script>
<script src="/common.js?v={ctx['ver']}" defer></script>
{js}
</head>
<body data-page="{e(active)}">
<a class="skip" href="#main">Saltar al contenido</a>
<header class="top">
  <div class="wrap top-inner">
    <a class="brand" href="/">{LOGO}<span><strong>Bifantasy</strong> Oráculo</span></a>
    <label class="score-pick" title="Elige el sistema de puntuación de tu liga">
      <span>Puntuación</span>
      <select id="score-select" aria-label="Sistema de puntuación">{ctx['score_options']}</select>
    </label>
  </div>
  <nav class="wrap nav" aria-label="Principal">{nav}</nav>
</header>
<main id="main" class="wrap">
{body}
</main>
<footer class="foot">
  <div class="wrap foot-inner">
    <div>
      <div class="brand small">{LOGO}<span><strong>Bifantasy</strong> Oráculo</span></div>
      <p>Herramienta independiente y no oficial para managers de fantasy. No está afiliada,
      patrocinada ni respaldada por Biwenger ni por LaLiga. Las marcas citadas pertenecen a sus titulares.</p>
      <p>Datos actualizados el {fmt_day(ctx['data']['updated'])}. Las probabilidades son estimaciones, no garantías.</p>
    </div>
    <nav aria-label="Pie">
      <a href="/metodologia/">Cómo calculamos</a>
      <a href="/liga/">Liga Bifantasy</a>
      <a href="/equipos/">Equipos</a>
      <a href="/aviso-legal/">Aviso legal</a>
      <a href="/privacidad/">Privacidad</a>
    </nav>
  </div>
</footer>
</body>
</html>
"""


def status_badge(p: dict) -> str:
    label, cls = STATUS.get(p["status"], (p["status"], ""))
    return f'<span class="st st-{cls}"><span class="dot" aria-hidden="true"></span>{e(label)}</span>'


def form_boxes(fit: list) -> str:
    if not fit:
        return ""
    chrono = list(reversed(fit))
    n = len(chrono)
    out = []
    for i, x in enumerate(chrono):
        when = "Última jornada" if i == n - 1 else f"Hace {n - 1 - i} jornadas"
        if isinstance(x, int):
            cls = "hi" if x >= 8 else "mid" if x >= 4 else "neg" if x < 0 else ""
            out.append(f'<span class="fb {cls}" title="{when}: {x} puntos">{x}</span>')
        else:
            label = "No jugó" if x is None else STATUS.get(x, (x,))[0]
            short = "–" if x is None else {"injured": "L", "sanctioned": "S", "doubt": "D"}.get(x, "·")
            out.append(f'<span class="fb out" title="{when}: {e(label)}">{short}</span>')
    return f'<span class="form" aria-label="Últimas {n} jornadas">{"".join(out)}</span>'


def next_game(ctx: dict, p: dict, long: bool = False) -> str:
    nx = ctx["data"]["teams"].get(p["team"], {}).get("next")
    if not nx:
        return ""
    opp = ctx["data"]["teams"].get(nx["opp"], {})
    txt = f'{"vs" if nx["home"] else "en"} <a href="/equipo/{e(opp.get("slug", ""))}/">{e(opp.get("name", "?"))}</a>'
    if long and nx.get("date"):
        txt += f' · {e(fmt_ts(nx["date"]))}'
    return f'<span class="next">{txt}</span>'


def team_link(ctx: dict, team_id) -> str:
    t = ctx["data"]["teams"].get(team_id, {})
    return f'<a href="/equipo/{e(t.get("slug", ""))}/">{e(t.get("name", "—"))}</a>'


def player_row(ctx: dict, p: dict, extra: str = "") -> str:
    sc = p["scores"].get(ctx["ps"], {})
    inc, cls = fmt_inc(p["inc"])
    pp = p.get("pPlay")
    return f"""<article class="row" data-id="{p['id']}">
  <div class="who"><span class="pos">{p['pos']}</span><div class="who-t">
    <a class="name" href="/jugador/{e(p['slug'])}/">{e(p['name'])}</a>
    <div class="team">{e(ctx['data']['teams'].get(p['team'], {}).get('name', '—'))}</div></div></div>
  <div class="meta">{status_badge(p)} {next_game(ctx, p)}</div>
  <div class="probs">{f'<span class="prob {pct_class(pp)}" title="Probabilidad de jugar">{pct(pp)}<small>juega</small></span>' if pp is not None else ''}
    <span class="stats"><b>{sc.get('pts', 0)}</b> pts · media <b>{str(sc.get('avg', 0)).replace('.', ',')}</b></span></div>
  {form_boxes(sc.get('fit'))}
  <div class="price"><div><span class="v">{fmt_m(p['price'])}</span><span class="d {cls}">{inc}</span></div>
    <button class="add" data-toggle="{p['id']}" aria-label="Añadir a mi plantilla" title="Añadir a mi plantilla">+</button></div>
  {extra}
</article>"""


def price_chart(hist: list) -> str:
    if len(hist) < 2:
        return f'<p class="hint">El histórico de precio se va llenando cada día (ahora hay {len(hist)} día).</p>'
    W, H, L, R, T, B = 520, 150, 46, 8, 10, 22
    vals = [h[1] for h in hist]
    lo, hi = min(vals), max(vals)
    if lo == hi:
        lo, hi = lo - 1e5, hi + 1e5
    x = lambda i: L + i / (len(hist) - 1) * (W - L - R)  # noqa: E731
    y = lambda v: T + (1 - (v - lo) / (hi - lo)) * (H - T - B)  # noqa: E731
    grid = "".join(
        f'<line class="grid" x1="{L}" x2="{W - R}" y1="{y(t):.1f}" y2="{y(t):.1f}"/>'
        f'<text class="axis" x="{L - 6}" y="{y(t) + 3:.1f}" text-anchor="end">{t / 1e6:.1f}M</text>'
        for t in (lo, (lo + hi) / 2, hi))
    path = "".join(f'{"L" if i else "M"}{x(i):.1f},{y(v):.1f}' for i, v in enumerate(vals))
    return f"""<div class="chart" data-hist='{e(json.dumps(hist))}'>
<svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="Evolución del precio de {fmt_m(vals[0])} a {fmt_m(vals[-1])}">
{grid}<text class="axis" x="{L}" y="{H - 5}">{hist[0][0][5:]}</text>
<text class="axis" x="{W - R}" y="{H - 5}" text-anchor="end">{hist[-1][0][5:]}</text>
<path class="line" d="{path}"/><line class="cross" x1="0" x2="0" y1="{T}" y2="{H - B}" visibility="hidden"/>
<circle class="pt" r="4" visibility="hidden"/></svg><div class="tip" hidden></div></div>"""


# ---------------------------------------------------------------- páginas

def p_home(ctx) -> str:
    d, ps = ctx["data"], ctx["ps"]
    pl = [p for p in d["players"] if p["pos"] != "ENT"]
    ups = sorted(pl, key=lambda p: -(p["inc"] or 0))[:5]
    downs = sorted(pl, key=lambda p: (p["inc"] or 0))[:5]
    cutoff = dt.datetime.now(dt.timezone.utc).timestamp() - 4 * 86400
    news = sorted([p for p in pl if p["status"] != "ok" and (p.get("since") or 0) > cutoff],
                  key=lambda p: -(p.get("since") or 0))[:5]
    if len(news) < 3:
        news = sorted([p for p in pl if p["status"] in ("injured", "doubt", "sanctioned")],
                      key=lambda p: -(p["price"] or 0))[:5]
    bargains = sorted([p for p in pl if p["scores"].get(ps, {}).get("vi") and p["played"] >= 4 and (p.get("pPlay") or 0) >= 0.6 and p["scores"][ps]["xp"] >= 3.5],
                      key=lambda p: -p["scores"][ps]["vi"])[:5]

    def mini(items, right):
        return "<ul class='mini'>" + "".join(
            f'<li><a href="/jugador/{e(p["slug"])}/">{e(p["name"])}</a><span class="muted">{e(d["teams"].get(p["team"], {}).get("name", ""))}</span>{right(p)}</li>'
            for p in items) + "</ul>"

    def incr(p):
        t, c = fmt_inc(p["inc"])
        return f'<span class="r {c}">{t}</span>'

    nr = d["nextRound"]["name"] if d.get("nextRound") else "la próxima jornada"
    body = f"""
<section class="hero">
  <p class="eyebrow">Para managers de Biwenger · Gratis · Sin registrarte</p>
  <h1>Decide tu once y tus fichajes con datos, no con corazonadas</h1>
  <p class="lead">Probabilidad de jugar, probabilidad de buen partido, puja ideal y alertas de tu plantilla.
  Todo actualizado cada mañana y en el sistema de puntuación de tu liga.</p>
  <div class="cta"><a class="btn primary" href="/plantilla/">Analizar mi plantilla</a>
  <a class="btn" href="/puja/">Calcular una puja</a></div>
  <p class="hint">No pedimos tu cuenta de Biwenger: añades tus jugadores y se guardan solo en tu navegador.</p>
</section>

<section class="grid4">
  <div class="card"><h2>Más suben hoy</h2>{mini(ups, incr)}<a class="more-link" href="/mercado/">Ver mercado →</a></div>
  <div class="card"><h2>Más bajan hoy</h2>{mini(downs, incr)}<a class="more-link" href="/mercado/#bajadas">Ver bajadas →</a></div>
  <div class="card"><h2>Bajas y dudas</h2>{mini(news, lambda p: status_badge(p))}<a class="more-link" href="/bajas/">Ver todas →</a></div>
  <div class="card"><h2>Chollos</h2>{mini(bargains, lambda p: f'<span class="r">{fmt_m(p["price"])}</span>')}<a class="more-link" href="/mercado/#chollos">Ver chollos →</a></div>
</section>

<section class="features">
  <h2>Qué puedes hacer</h2>
  <div class="feat-grid">
    <a class="feat" href="/plantilla/"><h3>Analizador de plantilla</h3><p>% de jugar y % de buen partido de cada jugador, alertas y el once ideal para {e(nr)}.</p></a>
    <a class="feat" href="/puja/"><h3>Puja ideal</h3><p>Elige un jugador y te decimos cuánto pujar según su valor, su tendencia y tu liga.</p></a>
    <a class="feat" href="/consultorio/"><h3>Consultorio</h3><p>¿A o B? ¿Qué delantero fichar por menos de 5 M? Respuestas al momento y con datos.</p></a>
    <a class="feat" href="/rivales/"><h3>Saldos de rivales</h3><p>Lleva el dinero de cada rival y descubre quién puede pagar tu cláusula.</p></a>
  </div>
</section>
"""
    return page(ctx, path="/", title=f"{SITE_NAME}: % de jugar, puja ideal y analizador de plantilla para Biwenger",
                description="Analiza tu plantilla de Biwenger: probabilidad de jugar, probabilidad de buen partido, puja ideal, chollos, subidas y bajadas de precio y bajas de cada jornada. Gratis y sin registrarte.",
                body=body, active="home",
                jsonld={"@context": "https://schema.org", "@type": "WebSite", "name": SITE_NAME, "url": ctx["url"] + "/",
                        "inLanguage": "es"})


def p_players(ctx) -> str:
    teams = "".join(f'<option value="{tid}">{e(t["name"])}</option>' for tid, t in sorted(ctx["data"]["teams"].items(), key=lambda x: x[1]["name"]))
    body = f"""
<h1>Jugadores</h1>
<p class="lead small">Busca, filtra y ordena los {len(ctx['data']['players'])} jugadores de {e(ctx['data']['name'] or 'LaLiga')} por puntos, probabilidad de jugar, forma o valor.</p>
<div class="filters">
  <input id="q" type="search" placeholder="Buscar jugador o equipo…" autocomplete="off" aria-label="Buscar">
  <div class="chips" id="pos-chips" role="group" aria-label="Posición">
    <button data-pos="" class="on">Todos</button><button data-pos="POR">POR</button><button data-pos="DEF">DEF</button><button data-pos="MED">MED</button><button data-pos="DEL">DEL</button>
  </div>
  <select id="team" aria-label="Equipo"><option value="">Todos los equipos</option>{teams}</select>
  <select id="status" aria-label="Estado"><option value="">Cualquier estado</option><option value="ok">Disponible</option><option value="doubt">Duda</option><option value="injured">Lesionado</option><option value="warned">Apercibido</option><option value="sanctioned">Sancionado</option></select>
  <select id="sort" aria-label="Ordenar"><option value="pts">Más puntos</option><option value="xp">Más puntos esperados</option><option value="pplay">Más % de jugar</option><option value="avg">Mejor media</option><option value="form">Mejor forma</option><option value="value">Mejor valor</option><option value="inc">Más sube hoy</option><option value="dec">Más baja hoy</option><option value="price">Más caro</option><option value="cheap">Más barato</option></select>
  <label class="maxp">Precio máx. <input id="maxp" type="text" min="0" step="0.5" inputmode="decimal" placeholder="M €"></label>
</div>
<div id="players-list" class="list"><p class="empty">Cargando jugadores…</p></div>
<button id="more" class="btn more" hidden>Mostrar más</button>
"""
    return page(ctx, path="/jugadores/", title="Jugadores de Biwenger: precio, % de jugar y puntos",
                description="Todos los jugadores de LaLiga en Biwenger con precio, variación diaria, estado, probabilidad de jugar, puntos y forma. Filtra por posición, equipo y precio.",
                body=body, active="players", scripts=("players.js",))


def p_market(ctx) -> str:
    d, ps = ctx["data"], ctx["ps"]
    pl = [p for p in d["players"] if p["pos"] != "ENT"]
    ups = [p for p in sorted(pl, key=lambda p: -(p["inc"] or 0)) if (p["inc"] or 0) > 0][:25]
    downs = [p for p in sorted(pl, key=lambda p: (p["inc"] or 0)) if (p["inc"] or 0) < 0][:25]
    bargains = sorted([p for p in pl if p["scores"].get(ps, {}).get("vi") and p["played"] >= 4 and (p.get("pPlay") or 0) >= 0.6 and p["scores"][ps]["xp"] >= 3.5],
                      key=lambda p: -p["scores"][ps]["vi"])[:25]
    total_up = sum(1 for p in pl if (p["inc"] or 0) > 0)
    total_down = sum(1 for p in pl if (p["inc"] or 0) < 0)
    body = f"""
<h1>Mercado de Biwenger hoy</h1>
<p class="lead small">Subidas, bajadas y chollos del {fmt_day(d['updated'])}. Hoy suben {total_up} jugadores y bajan {total_down}.</p>
<nav class="toc"><a href="#subidas">Subidas</a><a href="#bajadas">Bajadas</a><a href="#chollos">Chollos</a></nav>
<h2 id="subidas">Más suben</h2><div class="list">{''.join(player_row(ctx, p) for p in ups)}</div>
<h2 id="bajadas">Más bajan</h2><div class="list">{''.join(player_row(ctx, p) for p in downs)}</div>
<h2 id="chollos">Chollos</h2>
<p class="hint">Jugadores que dan más puntos esperados por millón que la mediana de su posición, con al menos 4 partidos, un 60 % o más de probabilidad de jugar y 3,5 puntos esperados o más. Puntos según {e(ctx['ps_name'])}.</p>
<div class="list">{''.join(player_row(ctx, p) for p in bargains)}</div>
"""
    return page(ctx, path="/mercado/", title=f"Mercado de Biwenger hoy: subidas, bajadas y chollos ({fmt_day(d['updated'])})",
                description=f"Qué jugadores suben y bajan de precio hoy en Biwenger y cuáles son los chollos de la jornada. Actualizado el {fmt_day(d['updated'])}.",
                body=body, active="market")


def p_injuries(ctx) -> str:
    d = ctx["data"]
    groups = [("injured", "Lesionados"), ("sanctioned", "Sancionados"), ("doubt", "Dudas"), ("warned", "Apercibidos")]
    parts = []
    toc = []
    for st, title in groups:
        items = sorted([p for p in d["players"] if p["status"] == st and p["pos"] != "ENT"],
                       key=lambda p: (d["teams"].get(p["team"], {}).get("name", ""), -(p["price"] or 0)))
        if not items:
            continue
        toc.append(f'<a href="#{st}">{title} ({len(items)})</a>')
        rows = "".join(player_row(ctx, p, f'<p class="row-info">{e(p["info"])}</p>' if p.get("info") else "") for p in items)
        parts.append(f'<h2 id="{st}">{title} ({len(items)})</h2><div class="list">{rows}</div>')
    nr = d["nextRound"]["name"] if d.get("nextRound") else "la próxima jornada"
    body = f"""
<h1>Lesionados, sancionados y dudas · {e(nr)}</h1>
<p class="lead small">Bajas de LaLiga para {e(nr)} con el motivo y la fecha estimada de vuelta cuando se conoce. Actualizado el {fmt_day(d['updated'])}.</p>
<nav class="toc">{''.join(toc)}</nav>
{''.join(parts)}
"""
    return page(ctx, path="/bajas/", title=f"Lesionados y sancionados de LaLiga para {nr} en Biwenger",
                description=f"Lista de lesionados, sancionados, dudas y apercibidos de LaLiga para {nr}, con motivo y fecha de vuelta. Actualizado el {fmt_day(d['updated'])}.",
                body=body, active="injuries")


def p_player(ctx, p) -> str:
    d, ps = ctx["data"], ctx["ps"]
    team = d["teams"].get(p["team"], {})
    sc = p["scores"].get(ps, {})
    inc, cls = fmt_inc(p["inc"])
    thr = d["goodThreshold"].get(ps, 6)
    rows = "".join(
        f'<tr><td>{e(s["name"])}</td><td>{p["scores"][str(s["id"])].get("pts", "—")}</td>'
        f'<td>{str(p["scores"][str(s["id"])].get("avg", "—")).replace(".", ",")}</td>'
        f'<td>{str(p["scores"][str(s["id"])].get("xp", "—")).replace(".", ",")}</td>'
        f'<td>{pct(p["scores"][str(s["id"])].get("pGood"))}</td></tr>'
        for s in d["scores"] if str(s["id"]) in p["scores"])
    mates = sorted([m for m in d["players"] if m["team"] == p["team"] and m["pos"] == p["pos"] and m["id"] != p["id"]],
                   key=lambda m: -(m["scores"].get(ps, {}).get("pts") or 0))[:6]
    why = "".join(f"<li>{e(r)}</li>" for r in p.get("why", []))
    pos_name = {"POR": "portero", "DEF": "defensa", "MED": "centrocampista", "DEL": "delantero", "ENT": "entrenador"}[p["pos"]]
    pp = p.get("pPlay")
    probs = "" if pp is None else f"""
<div class="kv">
  <div class="tile"><div class="k">Probabilidad de jugar</div><div class="n {pct_class(pp)}t">{pct(pp)}</div><div class="s">próximo partido</div></div>
  <div class="tile"><div class="k">Buen partido (≥{thr} pts)</div><div class="n">{pct(sc.get('pGood'))}</div><div class="s">{e(ctx['ps_name'])}</div></div>
  <div class="tile"><div class="k">Puntos esperados</div><div class="n">{str(sc.get('xp', '—')).replace('.', ',')}</div><div class="s">próximo partido</div></div>
</div>
{f'<ul class="why">{why}</ul>' if why else ''}"""
    desc = (f"{p['name']} ({team.get('name', '')}), {pos_name} en Biwenger: precio {fmt_m(p['price'])}, "
            f"{'probabilidad de jugar ' + pct(pp) + ', ' if pp is not None else ''}{sc.get('pts', 0)} puntos y estado {STATUS.get(p['status'], ('?',))[0].lower()}. Actualizado el {fmt_day(d['updated'])}.")
    body = f"""
<nav class="crumbs"><a href="/">Inicio</a> › <a href="/equipos/">Equipos</a> › {team_link(ctx, p['team'])} › <span>{e(p['name'])}</span></nav>
<div class="ph">
  <div>
    <h1>{e(p['name'])}</h1>
    <p class="sub2"><span class="pos">{p['pos']}</span>{(' / ' + ', '.join(p['alt'])) if p['alt'] else ''} · {team_link(ctx, p['team'])}</p>
    <p class="meta">{status_badge(p)} {('Próximo: ' + next_game(ctx, p, long=True)) if team.get('next') else ''}</p>
  </div>
  <button class="btn primary" data-toggle="{p['id']}">Añadir a mi plantilla</button>
</div>
{f'<div class="info"><strong>{e(STATUS.get(p["status"], ("",))[0])}:</strong> {e(p["info"])}</div>' if p.get('info') else ''}
{probs}
<div class="kv">
  <div class="tile"><div class="k">Precio</div><div class="n">{fmt_m(p['price'])}</div><div class="s {cls}">{inc} hoy</div></div>
  <div class="tile"><div class="k">Puntos ({e(ctx['ps_name'])})</div><div class="n">{sc.get('pts', 0)}</div><div class="s">{p['played']} partidos · media {str(sc.get('avg', 0)).replace('.', ',')}</div></div>
  <div class="tile"><div class="k">Temporada pasada</div><div class="n">{p['lastSeason'] if p['lastSeason'] is not None else '—'}</div><div class="s">puntos</div></div>
</div>
<h2>Últimas jornadas</h2>
<p>{form_boxes(sc.get('fit')) or '<span class="hint">Sin datos</span>'}</p>
<h2>Evolución del precio</h2>
{price_chart(p['hist'])}
<h2>Puntos según el sistema de puntuación</h2>
<div class="table-wrap"><table class="pts"><thead><tr><th>Sistema</th><th>Puntos</th><th>Media</th><th>Esperados</th><th>Buen partido</th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="cta-row"><a class="btn" href="/puja/?p={p['id']}">¿Cuánto pujar por {e(p['name'])}?</a> <a class="btn" href="/consultorio/?a={p['id']}">Compararlo con otro</a></p>
{f'<h2>Otros {POS_NAME[p["pos"]].lower()} de {e(team.get("name", ""))}</h2><div class="list">' + ''.join(player_row(ctx, m) for m in mates) + '</div>' if mates else ''}
<p class="hint">Las probabilidades son estimaciones del modelo v0. <a href="/metodologia/">Cómo las calculamos</a>.</p>
"""
    ld = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Inicio", "item": ctx["url"] + "/"},
        {"@type": "ListItem", "position": 2, "name": team.get("name", ""), "item": f"{ctx['url']}/equipo/{team.get('slug', '')}/"},
        {"@type": "ListItem", "position": 3, "name": p["name"], "item": f"{ctx['url']}/jugador/{p['slug']}/"}]}
    return page(ctx, path=f"/jugador/{p['slug']}/",
                title=f"{p['name']} en Biwenger: precio, % de jugar y puntos",
                description=desc, body=body, active="players", jsonld=ld)


def p_team(ctx, tid, t) -> str:
    d = ctx["data"]
    pl = [p for p in d["players"] if p["team"] == tid]
    order = ["POR", "DEF", "MED", "DEL", "ENT"]
    parts = []
    for pos in order:
        items = sorted([p for p in pl if p["pos"] == pos], key=lambda p: -(p.get("pPlay") or 0) * 100 - (p["scores"].get(ctx["ps"], {}).get("pts") or 0) / 1000)
        if items:
            parts.append(f'<h2>{POS_NAME[pos]}</h2><div class="list">{"".join(player_row(ctx, p) for p in items)}</div>')
    nx = t.get("next")
    opp = d["teams"].get(nx["opp"], {}) if nx else {}
    nxt = (f'<p class="lead small">Próximo partido: {"vs" if nx["home"] else "en"} <a href="/equipo/{e(opp.get("slug", ""))}/">{e(opp.get("name", "?"))}</a>'
           f'{(" · " + e(fmt_ts(nx["date"]))) if nx.get("date") else ""}</p>') if nx else ""
    bajas = sum(p["status"] in ("injured", "sanctioned") for p in pl)
    body = f"""
<nav class="crumbs"><a href="/">Inicio</a> › <a href="/equipos/">Equipos</a> › <span>{e(t['name'])}</span></nav>
<h1>{e(t['name'])} en Biwenger</h1>
{nxt}
<p class="hint">{len(pl)} jugadores · {bajas} bajas. Ordenados por probabilidad de jugar.</p>
{''.join(parts)}
"""
    return page(ctx, path=f"/equipo/{t['slug']}/", title=f"{t['name']} en Biwenger: plantilla, bajas y % de jugar",
                description=f"Plantilla del {t['name']} en Biwenger con precio, estado, probabilidad de jugar y puntos de cada jugador. {bajas} bajas para el próximo partido.",
                body=body, active="players")


def p_teams(ctx) -> str:
    d = ctx["data"]
    items = "".join(f'<a class="team-card" href="/equipo/{e(t["slug"])}/"><strong>{e(t["name"])}</strong>'
                    f'<span class="muted">{sum(p["team"] == tid and p["status"] in ("injured", "sanctioned") for p in d["players"])} bajas</span></a>'
                    for tid, t in sorted(d["teams"].items(), key=lambda x: x[1]["name"]))
    body = f'<h1>Equipos</h1><p class="lead small">Plantilla, bajas y probabilidad de jugar de cada equipo de {e(d["name"] or "LaLiga")}.</p><div class="team-grid">{items}</div>'
    return page(ctx, path="/equipos/", title="Equipos de LaLiga en Biwenger", body=body, active="players",
                description="Plantillas de los 20 equipos de LaLiga en Biwenger con bajas, precios y probabilidad de jugar.")


def p_squad(ctx) -> str:
    body = """
<h1>Analizador de plantilla</h1>
<p class="lead small">Añade tus jugadores y te mostramos la probabilidad de jugar y de hacer un buen partido, las alertas y tu once ideal.</p>
<div class="squad-add">
  <input id="squad-q" type="search" placeholder="Busca un jugador para añadirlo…" autocomplete="off" aria-label="Añadir jugador">
  <div id="squad-suggest" class="suggest" hidden></div>
</div>
<details class="paste"><summary>Pegar una lista de nombres</summary>
  <p class="hint">Escribe o pega los nombres de tus jugadores, uno por línea o separados por comas.</p>
  <textarea id="paste-box" rows="5" placeholder="Raphinha&#10;Pedri&#10;Mbappé"></textarea>
  <button class="btn" id="paste-go">Añadir jugadores</button> <span id="paste-result" class="hint"></span>
</details>
<div id="squad-summary" class="summary"></div>
<div id="squad-lineup"></div>
<div id="squad-alerts"></div>
<div id="squad-list"></div>
<p class="hint">Tu plantilla se guarda solo en este navegador. No pedimos ni guardamos tu cuenta de Biwenger.</p>
"""
    return page(ctx, path="/plantilla/", title="Analizador de plantilla para Biwenger: % de jugar y once ideal",
                description="Analiza tu plantilla de Biwenger gratis: probabilidad de jugar y de buen partido de cada jugador, alertas de lesiones y sanciones y el once ideal para la próxima jornada.",
                body=body, active="squad", scripts=("squad.js",))


def p_bid(ctx) -> str:
    body = """
<h1>Puja ideal</h1>
<p class="lead small">Elige un jugador del mercado y te decimos cuánto pujar: una puja mínima, la ideal y el máximo que tiene sentido pagar.</p>
<div class="form-grid">
  <label class="full">Jugador
    <span class="squad-add"><input id="bid-q" type="search" placeholder="Busca un jugador…" autocomplete="off"><span id="bid-suggest" class="suggest" hidden></span></span></label>
  <label>Managers en tu liga <input id="bid-managers" type="number" min="2" max="30" value="10" inputmode="numeric"></label>
  <label>¿Cuánto lo necesitas?
    <select id="bid-need"><option value="1">Me vendría bien</option><option value="2" selected>Lo quiero</option><option value="3">Lo necesito sí o sí</option></select></label>
  <label>Tu saldo (M €, opcional) <input id="bid-budget" type="text" min="0" step="0.1" inputmode="decimal" placeholder="Ej. 12,5"></label>
</div>
<div id="bid-result"></div>
<p class="hint">La puja se calcula con el precio de hoy, su tendencia, sus puntos esperados frente a jugadores de su posición, su probabilidad de jugar y cuánta competencia hay en tu liga. <a href="/metodologia/#puja">Cómo la calculamos</a>.</p>
"""
    return page(ctx, path="/puja/", title="Puja ideal en Biwenger: cuánto pujar por un jugador",
                description="Calcula cuánto pujar por un jugador en Biwenger: puja mínima, ideal y máxima según su precio, tendencia, valor y la competencia de tu liga.",
                body=body, active="bid", scripts=("bid.js",))


def p_advisor(ctx) -> str:
    body = """
<h1>Consultorio</h1>
<p class="lead small">Resuelve tus dudas de alineación y fichajes al momento, con datos de hoy.</p>
<div class="tabs2" role="tablist">
  <button role="tab" aria-selected="true" data-mode="vs">¿A o B?</button>
  <button role="tab" aria-selected="false" data-mode="find">¿Qué fichar?</button>
</div>
<section id="mode-vs">
  <p class="hint">Elige de 2 a 4 jugadores y te decimos a quién alinear en el próximo partido.</p>
  <div class="squad-add"><input id="vs-q" type="search" placeholder="Añade un jugador a la comparación…" autocomplete="off"><div id="vs-suggest" class="suggest" hidden></div></div>
  <div id="vs-picked" class="picked"></div>
  <div id="vs-result"></div>
</section>
<section id="mode-find" hidden>
  <div class="form-grid">
    <label>Posición <select id="f-pos"><option value="POR">Portero</option><option value="DEF">Defensa</option><option value="MED">Centrocampista</option><option value="DEL" selected>Delantero</option></select></label>
    <label>Precio máximo (M €) <input id="f-max" type="text" min="0" step="0.5" value="5" inputmode="decimal"></label>
    <label>Prioridad <select id="f-goal"><option value="xp">Puntos en la próxima jornada</option><option value="value">Mejor relación puntos/precio</option><option value="rise">Que suba de precio</option></select></label>
  </div>
  <div id="find-result"></div>
</section>
<p class="hint">Respuestas automáticas con el modelo v0. Pronto podrás preguntar al oráculo en lenguaje natural.</p>
"""
    return page(ctx, path="/consultorio/", title="Consultorio fantasy: ¿a quién alineo? ¿qué fichar?",
                description="Consultorio fantasy automático para Biwenger: compara jugadores para saber a quién alinear y encuentra el mejor fichaje por posición y precio.",
                body=body, active="advisor", scripts=("advisor.js",))


def p_rivals(ctx) -> str:
    body = """
<h1>Saldos de rivales</h1>
<p class="lead small">Lleva el dinero de cada rival de tu liga y descubre quién puede pagar tu cláusula o pujar fuerte por un jugador.</p>
<div class="card">
  <h2>¿Quién puede pagar…?</h2>
  <div class="form-grid">
    <label>Importe (M €) <input id="r-amount" type="text" min="0" step="0.1" inputmode="decimal" placeholder="Ej. la cláusula de tu delantero"></label>
    <label>Margen de deuda permitido en tu liga (M €) <input id="r-debt" type="text" min="0" step="0.5" value="0" inputmode="decimal"></label>
  </div>
  <div id="r-who"></div>
</div>
<div class="row-actions"><input id="r-new" type="text" placeholder="Nombre del rival" aria-label="Nombre del rival"><input id="r-new-saldo" type="text" step="0.1" placeholder="Saldo actual (M €)" inputmode="decimal" aria-label="Saldo actual"><button class="btn primary" id="r-add">Añadir rival</button></div>
<div id="r-list"></div>
<details class="paste"><summary>Copia de seguridad</summary>
  <p class="hint">Tus datos se guardan solo en este navegador. Exporta una copia para pasarla a otro dispositivo.</p>
  <button class="btn" id="r-export">Exportar</button> <button class="btn" id="r-import">Importar</button>
  <textarea id="r-io" rows="4" hidden></textarea>
</details>
"""
    return page(ctx, path="/rivales/", title="Calculadora de saldos de rivales para Biwenger",
                description="Controla el saldo de cada rival de tu liga de Biwenger: compras, ventas, cláusulas y premios por jornada. Descubre quién puede pagar tu cláusula.",
                body=body, active="rivals", scripts=("rivals.js",))


def p_league(ctx) -> str:
    if LEAGUE.get("code"):
        join = f'<p class="cta"><a class="btn primary" href="{e(LEAGUE["url"] or "#")}">Unirme a la liga</a></p><p>Código: <strong>{e(LEAGUE["code"])}</strong></p>'
    else:
        join = '<div class="info">Muy pronto abriremos la liga. Síguenos en X para enterarte el primero.</div>'
    body = f"""
<h1>Liga Bifantasy</h1>
<p class="lead small">Una liga abierta para competir con la comunidad de Bifantasy Oráculo durante la temporada.</p>
{join}
<h2>Cómo funcionará</h2>
<ul><li>Liga pública con el sistema de puntuación más usado.</li><li>Clasificación y mejores jornadas comentadas en X.</li><li>Las bases y posibles premios se publicarán antes de empezar.</li></ul>
"""
    return page(ctx, path="/liga/", title="Liga Bifantasy", description="Únete a la liga de la comunidad de Bifantasy Oráculo.",
                body=body)


def p_method(ctx) -> str:
    thr = ctx["data"]["goodThreshold"]
    thr_rows = "".join(f'<tr><td>{e(s["name"])}</td><td>{thr.get(str(s["id"]), "—")} puntos</td></tr>' for s in ctx["data"]["scores"])
    body = f"""
<h1>Cómo calculamos</h1>
<p class="lead small">Queremos que sepas de dónde sale cada número. Este es el modelo v0: reglas sencillas y transparentes. A medida que acumulemos jornadas lo sustituiremos por un modelo calibrado y publicaremos su acierto.</p>
<h2>Probabilidad de jugar</h2>
<ul>
<li>Partimos de los partidos jugados esta temporada sobre los de su equipo.</li>
<li>Lo combinamos con las 5 últimas jornadas, dando más peso a las más recientes. Las jornadas en que estaba lesionado o sancionado no cuentan.</li>
<li>Ajustamos por su estado: una duda se queda en la mitad, un lesionado o sancionado casi a cero. Si vuelve de una lesión, restamos un 20 %.</li>
</ul>
<h2>Buen partido</h2>
<p>Probabilidad de jugar multiplicada por la frecuencia con la que supera el umbral de buen partido cuando juega, suavizada con su media de la temporada. El umbral depende del sistema de puntuación:</p>
<div class="table-wrap"><table class="pts"><thead><tr><th>Sistema</th><th>Buen partido</th></tr></thead><tbody>{thr_rows}</tbody></table></div>
<h2>Puntos esperados</h2>
<p>Probabilidad de jugar × la media por partido (mitad temporada, mitad últimas jornadas) × un pequeño ajuste por jugar en casa (+8 %) o fuera (−6 %).</p>
<h2 id="puja">Puja ideal</h2>
<p>Sobre el precio de hoy sumamos un porcentaje que crece si el jugador está subiendo, si da más puntos esperados por millón que la mediana de su posición, si hay muchos managers en tu liga y cuanto más lo necesites. Baja si es duda y desaconsejamos pujar si está lesionado o sancionado.</p>
<h2>Datos</h2>
<p>Usamos los datos públicos de la competición, actualizados cada mañana. No accedemos a cuentas ni ligas privadas.</p>
"""
    return page(ctx, path="/metodologia/", title="Cómo calculamos el % de jugar y la puja ideal",
                description="Metodología de Bifantasy Oráculo: cómo estimamos la probabilidad de jugar, de buen partido, los puntos esperados y la puja ideal.",
                body=body)


def p_legal(ctx) -> str:
    body = """
<h1>Aviso legal</h1>
<p><strong>Titular:</strong> [pendiente de completar: nombre o razón social, NIF y email de contacto].</p>
<p>Bifantasy Oráculo es una herramienta informativa, gratuita, independiente y no oficial. No está afiliada,
patrocinada ni respaldada por Biwenger, LaLiga ni ningún club. Los nombres de competiciones, clubes y jugadores
se usan solo para identificarlos.</p>
<p>Las probabilidades, puntos esperados y recomendaciones son estimaciones automáticas y pueden fallar. Úsalas como
apoyo para tus decisiones, no como garantía.</p>
"""
    return page(ctx, path="/aviso-legal/", title="Aviso legal", description="Aviso legal de Bifantasy Oráculo.", body=body)


def p_privacy(ctx) -> str:
    body = """
<h1>Privacidad</h1>
<ul>
<li><strong>Sin cuentas:</strong> no pedimos registro ni acceso a tu cuenta de Biwenger.</li>
<li><strong>Tus datos se quedan en tu navegador:</strong> la plantilla, los rivales y tus preferencias se guardan en el almacenamiento local de tu navegador y no se envían a ningún servidor.</li>
<li><strong>Estadísticas anónimas:</strong> usamos Vercel Web Analytics para contar visitas de forma agregada, sin cookies y sin identificarte.</li>
<li>Puedes borrar tus datos en cualquier momento borrando los datos del sitio en tu navegador.</li>
</ul>
"""
    return page(ctx, path="/privacidad/", title="Privacidad", description="Política de privacidad de Bifantasy Oráculo.", body=body)


def p_404(ctx) -> str:
    body = '<section class="hero"><h1>Página no encontrada</h1><p class="lead">Puede que el jugador haya cambiado de equipo o ya no esté en la competición.</p><p class="cta"><a class="btn primary" href="/jugadores/">Buscar jugador</a> <a class="btn" href="/">Ir al inicio</a></p></section>'
    return page(ctx, path="/404", title="Página no encontrada", description="Página no encontrada.", body=body, noindex=True)


# ---------------------------------------------------------------- build

def write(rel: str, content: str) -> None:
    path = OUT / rel.strip("/") if rel.endswith(".html") or "." in rel.rsplit("/", 1)[-1] else OUT / rel.strip("/") / "index.html"
    if rel == "/":
        path = OUT / "index.html"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--competition", default="la-liga")
    ap.add_argument("--site-url", default=DEFAULT_URL)
    args = ap.parse_args()

    data = collect(args.competition)
    ps = str(data["primaryScore"])
    ctx = {
        "data": data, "url": args.site_url.rstrip("/"), "ps": ps,
        "ps_name": next((s["name"] for s in data["scores"] if str(s["id"]) == ps), "AS"),
        "ver": data["updated"].replace("-", ""),
        "score_options": "".join(f'<option value="{s["id"]}">{e(s["name"])}</option>' for s in data["scores"]),
    }

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)
    shutil.copytree(STATIC_DIR, OUT, dirs_exist_ok=True)
    (OUT / "data").mkdir()
    (OUT / "data" / f"{args.competition}.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))

    pages = {
        "/": p_home(ctx), "/jugadores/": p_players(ctx), "/mercado/": p_market(ctx), "/bajas/": p_injuries(ctx),
        "/plantilla/": p_squad(ctx), "/puja/": p_bid(ctx), "/consultorio/": p_advisor(ctx), "/rivales/": p_rivals(ctx),
        "/liga/": p_league(ctx), "/metodologia/": p_method(ctx), "/equipos/": p_teams(ctx),
        "/aviso-legal/": p_legal(ctx), "/privacidad/": p_privacy(ctx),
    }
    for tid, t in data["teams"].items():
        pages[f"/equipo/{t['slug']}/"] = p_team(ctx, tid, t)
    for p in data["players"]:
        pages[f"/jugador/{p['slug']}/"] = p_player(ctx, p)
    for rel, content in pages.items():
        write(rel, content)
    (OUT / "404.html").write_text(p_404(ctx), encoding="utf-8")

    lastmod = data["updated"]
    urls = "".join(f"<url><loc>{e(ctx['url'] + rel)}</loc><lastmod>{lastmod}</lastmod></url>" for rel in pages)
    (OUT / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>')
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {ctx['url']}/sitemap.xml\n")
    print(f"{OUT}: {len(pages) + 1} páginas, {len(data['players'])} jugadores, datos del {data['updated']} ({data['days']} días)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
