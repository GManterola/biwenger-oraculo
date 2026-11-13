"""Modelo v0 de Bifantasy Oráculo.

Heurísticas transparentes (sin entrenamiento todavía) calculadas a partir de
los datos públicos diarios. Cuando haya histórico suficiente se sustituirán por
un modelo calibrado y se publicará su acierto.

- p_play: probabilidad de que el jugador participe en el próximo partido.
- p_good: probabilidad de "buen partido" (superar un umbral de puntos que
  depende del sistema de puntuación) = p_play * P(buen partido | juega).
- xp: puntos esperados en el próximo partido.
"""

from __future__ import annotations

import statistics
from collections import defaultdict

# Peso de cada una de las últimas 5 jornadas (de más reciente a más antigua).
RECENT_WEIGHTS = [0.32, 0.24, 0.18, 0.14, 0.12]
UNAVAILABLE = {"injured", "sanctioned", "discarded"}
STATUS_FACTOR = {
    "ok": 1.0,
    "warned": 1.0,
    "doubt": 0.5,
    "injured": 0.03,
    "sanctioned": 0.01,
    "discarded": 0.02,
}
HOME_FACTOR = {True: 1.08, False: 0.94}


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def team_games(players: list[dict]) -> dict[int, int]:
    """Partidos jugados por cada equipo (aprox.: máximo de partidos de sus jugadores)."""
    tg: dict[int, int] = defaultdict(int)
    for p in players:
        tg[p["team"]] = max(tg[p["team"]], p["played"])
    return tg


def good_thresholds(players: list[dict]) -> dict[str, int]:
    """Umbral de 'buen partido' por sistema: ~1,75 veces la media por actuación.

    En el sistema de AS sale 6 puntos, que coincide con el criterio habitual.
    """
    by_score: dict[str, list[int]] = defaultdict(list)
    for p in players:
        for s, v in p["scores"].items():
            by_score[s].extend(x for x in v.get("fit") or [] if isinstance(x, int))
    out = {}
    for s, vals in by_score.items():
        mean = statistics.mean(vals) if vals else 3.4
        out[s] = max(3, round(mean * 1.75))
    return out


def p_play(p: dict, games: int, fit: list) -> tuple[float, list[str]]:
    """Probabilidad de jugar y razones legibles."""
    reasons: list[str] = []
    season = (p["played"] + 0.5) / (games + 1) if games else 0.5

    num = den = 0.0
    for w, x in zip(RECENT_WEIGHTS, fit or []):
        if isinstance(x, str) and x in UNAVAILABLE | {"doubt"}:
            continue  # no estaba disponible: no dice nada de la confianza del entrenador
        den += w
        num += w * (1.0 if isinstance(x, int) else 0.0)
    if den:
        prior_w = 0.3
        recent = (num + prior_w * season) / (den + prior_w)
        base = 0.6 * recent + 0.4 * season
    else:
        base = season

    played_recent = sum(isinstance(x, int) for x in (fit or [])[:5])
    if fit and fit[0] is None and len(fit) > 1 and fit[1] is None:
        reasons.append("No ha jugado las 2 últimas jornadas")
    elif played_recent >= 4:
        reasons.append(f"Ha jugado {played_recent} de las 5 últimas jornadas")
    if games:
        reasons.append(f"{p['played']} de {games} partidos esta temporada")

    if fit and isinstance(fit[0], str) and fit[0] in UNAVAILABLE and p["status"] in ("ok", "warned"):
        base *= 0.8
        reasons.append("Vuelve de una baja: puede no ser titular")

    status = p.get("status") or "ok"
    base *= STATUS_FACTOR.get(status, 1.0)
    if status == "doubt":
        reasons.insert(0, "Es duda para el próximo partido")
    elif status in UNAVAILABLE:
        reasons.insert(0, {"injured": "Está lesionado", "sanctioned": "Está sancionado",
                           "discarded": "Está descartado"}[status])
    elif status == "warned":
        reasons.append("Apercibido: una amarilla más y se pierde el siguiente")
    return clamp(base, 0.01, 0.97), reasons


def enrich(players: list[dict], teams: dict, primary_score: str) -> dict:
    """Añade p_play, y por sistema: avg, xp, p_good y vi (índice de valor)."""
    games = team_games(players)
    thresholds = good_thresholds(players)

    for p in players:
        if p["pos"] == "ENT":
            p["pPlay"] = None
            continue
        fit_primary = p["scores"].get(primary_score, {}).get("fit") or []
        prob, reasons = p_play(p, games.get(p["team"], 0), fit_primary)
        p["pPlay"] = round(prob, 3)
        p["why"] = reasons
        nxt = (teams.get(p["team"]) or {}).get("next")
        home = HOME_FACTOR.get(nxt["home"], 1.0) if nxt else 1.0

        for s, v in p["scores"].items():
            apps = [x for x in v.get("fit") or [] if isinstance(x, int)]
            season_avg = (v.get("pts") or 0) / p["played"] if p["played"] else 0.0
            recent_avg = statistics.mean(apps) if apps else season_avg
            per_game = 0.5 * recent_avg + 0.5 * season_avg if apps else season_avg
            thr = thresholds.get(s, 6)
            prior = clamp(0.05 + (season_avg - 1) * 0.12, 0.03, 0.85)
            goods = sum(x >= thr for x in apps)
            pg_given = (goods + 3 * prior) / (len(apps) + 3)
            v["avg"] = round(season_avg, 2)
            v["xp"] = round(prob * per_game * home, 2)
            v["pGood"] = round(prob * pg_given, 3)

    # Índice de valor: puntos esperados por millón frente a la mediana de su posición.
    for s in thresholds:
        by_pos: dict[str, list[float]] = defaultdict(list)
        for p in players:
            v = p["scores"].get(s)
            if p["pos"] != "ENT" and v and p.get("price") and p["played"]:
                by_pos[p["pos"]].append(v["xp"] / (p["price"] / 1e6))
        med = {k: statistics.median(x) or 1e-9 for k, x in by_pos.items() if x}
        for p in players:
            v = p["scores"].get(s)
            if p["pos"] != "ENT" and v and p.get("price") and p["pos"] in med:
                v["vi"] = round((v["xp"] / (p["price"] / 1e6)) / med[p["pos"]], 2)

    return {"goodThreshold": thresholds}
