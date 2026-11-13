"""Genera web/data/<competicion>.json a partir de las descargas de data/raw.

Toma la descarga más reciente de cada sistema de puntuación y el histórico de
precios de todos los días disponibles. El resultado es un JSON compacto que la
web estática carga directamente.

Uso:
    python collector/build_site_data.py [--competition la-liga] [--history-days 60]
"""

from __future__ import annotations

import argparse
import gzip
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
OUT_DIR = ROOT / "web" / "data"
POSITIONS = {1: "POR", 2: "DEF", 3: "MED", 4: "DEL", 5: "ENT"}
PRIMARY_SCORE = 1  # la descarga de este sistema aporta precios, estado y equipos


def load(path: Path) -> dict:
    return json.loads(gzip.decompress(path.read_bytes()))["data"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--competition", default="la-liga")
    ap.add_argument("--history-days", type=int, default=60)
    args = ap.parse_args()

    comp_dir = RAW_DIR / args.competition
    files = sorted(comp_dir.glob("*_score*.json.gz"))
    if not files:
        raise SystemExit(f"No hay descargas en {comp_dir}")

    by_day: dict[str, dict[int, Path]] = defaultdict(dict)
    for f in files:
        day, score = f.name.removesuffix(".json.gz").split("_score")
        by_day[day][int(score)] = f
    days = sorted(by_day)
    latest_day = days[-1]
    latest = by_day[latest_day]
    primary_score = PRIMARY_SCORE if PRIMARY_SCORE in latest else min(latest)
    base = load(latest[primary_score])

    # Histórico de precios (solo del sistema principal; el precio no depende del sistema).
    history: dict[int, list[list]] = defaultdict(list)
    for day in days[-args.history_days:]:
        f = by_day[day].get(primary_score) or next(iter(by_day[day].values()))
        for p in load(f)["players"].values():
            history[p["id"]].append([day, p.get("price")])

    # Puntos y forma por sistema de puntuación.
    per_score: dict[int, dict[int, dict]] = {}
    for score, f in latest.items():
        per_score[score] = {p["id"]: p for p in load(f)["players"].values()}

    teams = {}
    for t in base["teams"].values():
        nxt = None
        for g in t.get("nextGames") or []:
            home_id, away_id = g["home"]["id"], g["away"]["id"]
            is_home = home_id == t["id"]
            nxt = {"opp": away_id if is_home else home_id, "home": is_home,
                   "date": g.get("date"), "round": (g.get("round") or {}).get("id")}
            break
        teams[t["id"]] = {"name": t["name"], "slug": t.get("slug"), "next": nxt}

    players = []
    for p in base["players"].values():
        pid = p["id"]
        info = p.get("statusInfo")
        players.append({
            "id": pid,
            "name": p["name"],
            "slug": p.get("slug"),
            "team": p.get("teamID"),
            "pos": POSITIONS.get(p.get("position"), "?"),
            "alt": [POSITIONS.get(a, "?") for a in p.get("altPositions") or []],
            "price": p.get("price"),
            "inc": p.get("priceIncrement"),
            "status": p.get("status"),
            "info": info if isinstance(info, str) else None,
            "since": p.get("statusChange"),
            "played": (p.get("playedHome") or 0) + (p.get("playedAway") or 0),
            "lastSeason": p.get("pointsLastSeason"),
            "scores": {
                str(s): {"pts": sp[pid].get("points"), "fit": sp[pid].get("fitness")}
                for s, sp in per_score.items() if pid in sp
            },
            "hist": history.get(pid, []),
        })

    rounds = base.get("season", {}).get("rounds", [])
    next_round = next((r for r in rounds if r.get("status") != "finished"), None)
    scores = [s for s in base.get("scores", []) if s["id"] in per_score]

    out = {
        "competition": args.competition,
        "name": base.get("name"),
        "season": base.get("season", {}).get("name"),
        "updated": latest_day,
        "nextRound": {"id": next_round["id"], "name": next_round["name"]} if next_round else None,
        "scores": [{"id": s["id"], "name": s["name"]} for s in scores],
        "teams": teams,
        "players": players,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{args.competition}.json"
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"{out_path}: {len(players)} jugadores, {len(scores)} sistemas, {len(days)} días de histórico")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
