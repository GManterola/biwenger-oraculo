"""Recolector diario de datos públicos de Biwenger (sin cuentas de usuario).

Descarga el listado público de jugadores de una competición y guarda una
"foto" diaria en SQLite: precio, variación, estado (lesionado, duda...) y
puntos. Con el histórico de fotos se entrenarán después el modelo de
probabilidad de jugar y la predicción de precios.

Uso:
    python collector/collect.py                 # LaLiga, sistema de puntuación por defecto
    python collector/collect.py --score 2       # otro sistema de puntuación
    python collector/collect.py --competition premier-league
    python collector/collect.py --rebuild       # recrea la base de datos desde data/raw

Cada descarga se guarda comprimida en data/raw/<competicion>/<dia>_score<n>.json.gz
(se versiona en git). La base SQLite es un derivado y se puede regenerar.

Solo usa la librería estándar. Si la red pasa por un proxy con CA propia,
exporta SSL_CERT_FILE apuntando al bundle de certificados.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import sqlite3
import sys
import urllib.request
from pathlib import Path

BASE_URL = "https://cf.biwenger.com/api/v2/competitions/{competition}/data?lang=es&score={score}"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "biwenger.db"
RAW_DIR = DATA_DIR / "raw"
POSITIONS = {1: "POR", 2: "DEF", 3: "MED", 4: "DEL", 5: "ENT"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY,
    competition TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT
);
CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY,
    competition TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT,
    team_id INTEGER,
    position TEXT,
    updated_at TEXT NOT NULL
);
-- Una fila por jugador, día y sistema de puntuación.
CREATE TABLE IF NOT EXISTS player_snapshots (
    player_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    score INTEGER NOT NULL,
    team_id INTEGER,
    price INTEGER,
    price_increment INTEGER,
    status TEXT,
    status_info TEXT,
    points INTEGER,
    played_home INTEGER,
    played_away INTEGER,
    points_home INTEGER,
    points_away INTEGER,
    raw_json TEXT,
    PRIMARY KEY (player_id, day, score)
);
CREATE INDEX IF NOT EXISTS idx_snap_day ON player_snapshots(day);
"""


def fetch(competition: str, score: int) -> dict:
    url = BASE_URL.format(competition=competition, score=score)
    req = urllib.request.Request(url, headers={"User-Agent": "biwenger-oraculo-collector/0.1"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def store(conn: sqlite3.Connection, payload: dict, competition: str, score: int, day: str) -> int:
    data = payload.get("data", payload)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    for t in (data.get("teams") or {}).values():
        conn.execute(
            "INSERT INTO teams(id, competition, name, slug) VALUES (?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, slug=excluded.slug",
            (t["id"], competition, t.get("name"), t.get("slug")),
        )

    players = (data.get("players") or {}).values()
    n = 0
    for p in players:
        conn.execute(
            "INSERT INTO players(id, competition, name, slug, team_id, position, updated_at) "
            "VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, "
            "slug=excluded.slug, team_id=excluded.team_id, position=excluded.position, "
            "updated_at=excluded.updated_at",
            (p["id"], competition, p.get("name"), p.get("slug"), p.get("teamID"),
             POSITIONS.get(p.get("position"), str(p.get("position"))), now),
        )
        status_info = p.get("statusInfo")
        conn.execute(
            "INSERT OR REPLACE INTO player_snapshots(player_id, day, score, team_id, price, "
            "price_increment, status, status_info, points, played_home, played_away, "
            "points_home, points_away, raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (p["id"], day, score, p.get("teamID"), p.get("price"), p.get("priceIncrement"),
             p.get("status"), json.dumps(status_info, ensure_ascii=False) if status_info else None,
             p.get("points"), p.get("playedHome"), p.get("playedAway"),
             p.get("pointsHome"), p.get("pointsAway"), json.dumps(p, ensure_ascii=False)),
        )
        n += 1
    conn.commit()
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--competition", default="la-liga")
    ap.add_argument("--score", type=int, default=1, help="Sistema de puntuación de Biwenger")
    ap.add_argument("--db", type=Path, default=DB_PATH)
    ap.add_argument("--rebuild", action="store_true", help="Recrear la base desde data/raw")
    args = ap.parse_args()

    args.db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.db)
    conn.executescript(SCHEMA)

    if args.rebuild:
        total = 0
        for f in sorted(RAW_DIR.glob("*/*_score*.json.gz")):
            day, score = f.name.removesuffix(".json.gz").split("_score")
            payload = json.loads(gzip.decompress(f.read_bytes()))
            total += store(conn, payload, f.parent.name, int(score), day)
        print(f"Reconstruida {args.db}: {total} filas desde {RAW_DIR}")
        return 0

    day = dt.date.today().isoformat()
    payload = fetch(args.competition, args.score)
    raw_path = RAW_DIR / args.competition / f"{day}_score{args.score}.json.gz"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_bytes(gzip.compress(json.dumps(payload, ensure_ascii=False).encode(), mtime=0))
    n = store(conn, payload, args.competition, args.score, day)
    print(f"{day}: guardados {n} jugadores de {args.competition} (score={args.score}) en {args.db}")
    return 0 if n else 1

if __name__ == "__main__":
    sys.exit(main())
