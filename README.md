# Biwenger Oráculo

Herramienta no oficial para managers de Biwenger: probabilidad de jugar,
análisis de plantilla, seguimiento de rivales y un oráculo que responde dudas
con datos. **No conecta cuentas de Biwenger**: la plantilla se carga a mano o
con una captura de pantalla.

## Estado

- [x] Recolector diario de datos públicos (`collector/collect.py`)
- [x] Automatización diaria con GitHub Actions (`.github/workflows/collect.yml`)
- [ ] Prototipo web: buscador de jugadores y carga de plantilla
- [ ] Modelo de probabilidad de jugar (con acierto publicado)
- [ ] Seguimiento de saldos de rivales
- [ ] Oráculo
- [ ] Cuenta de X

## Datos

`data/raw/<competicion>/<dia>_score<n>.json.gz` guarda la descarga diaria
original para cada sistema de puntuación (`score`). La base SQLite
(`data/biwenger.db`) no se versiona; se regenera con:

```bash
python collector/collect.py --rebuild
```

Descarga manual:

```bash
python collector/collect.py --competition la-liga --score 1
```

Campos útiles por jugador: precio y variación diaria, estado (`ok`, `doubt`,
`injured`, `warned`, `sanctioned`) con motivo, puntos totales y casa/fuera,
puntos de la temporada pasada y `fitness` (últimas 5 jornadas: puntos o estado).
