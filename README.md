# Bifantasy Oráculo

Herramienta independiente y no oficial para managers de fantasy (compatible con Biwenger): probabilidad de jugar,
análisis de plantilla, seguimiento de rivales y un oráculo que responde dudas
con datos. **No conecta cuentas de Biwenger**: la plantilla se carga a mano o
con una captura de pantalla.

## Estado

- [x] Recolector diario de datos públicos (`collector/collect.py`) con los 7 sistemas de puntuación
- [x] Automatización diaria con GitHub Actions (`.github/workflows/collect.yml`): descarga, genera la web y la sube; Vercel la publica
- [x] Modelo v0 (`site/model.py`): % de jugar, % de buen partido, puntos esperados e índice de valor
- [x] Web multipágina (`site/build.py` → `web/`): portada, jugadores, mercado, bajas, ficha por jugador y por equipo
- [x] Analizador de plantilla con alertas y once ideal (`/plantilla/`)
- [x] Puja ideal (`/puja/`), consultorio automático (`/consultorio/`), saldos de rivales (`/rivales/`)
- [x] SEO: títulos y descripciones, sitemap, robots, datos estructurados, imagen para redes
- [x] Previa de jornada (`/jornada/`) y mejores por posición (`/mejores/...`)
- [x] Posts diarios para X con imágenes (`/x/`, no indexada) y kit de lanzamiento (`marketing/`)
- [x] Oráculo con IA (`/oraculo/`) y lectura de capturas en la plantilla: listos, se activan con `ANTHROPIC_API_KEY` en Vercel
- [ ] Liga Bifantasy: poner el código en `site/config.json`
- [ ] Calibrar el modelo con histórico y publicar su acierto
- [ ] Otros juegos (LaLiga Fantasy/Mister, Futmondo, Comunio…) y competiciones
- [ ] Cuenta de X

## Web

`site/build.py` genera la web estática completa en `web/` (no se edita a mano):
páginas HTML, `web/data/la-liga.json` para las herramientas, `sitemap.xml` y
`robots.txt`. Estilos, JavaScript e iconos están en `site/static/`.
La URL pública se configura con `SITE_URL` (por defecto
`https://bifantasy-oraculo.vercel.app`).

```bash
python site/build.py && python -m http.server -d web 8000
```

## Configuración (`site/config.json`)

URL pública, verificación de Google Search Console, usuario de X, datos del
aviso legal y código de la liga. Cualquier cambio se aplica en la siguiente
generación de la web.

## Oráculo con IA

Funciones de Vercel en `site/vercel/api/` (se copian a `web/api/`):
`/api/oraculo` (preguntas) y `/api/captura` (leer una captura de la plantilla).
Usan el SDK oficial `@anthropic-ai/sdk`. Para activarlas, en Vercel →
Settings → Environment Variables:

- `ANTHROPIC_API_KEY` (obligatoria)
- `ORACULO_MODEL` (opcional, por defecto `claude-opus-5-5`; `claude-haiku-5-5` es mucho más barato)
- `ORACULO_LIMIT_PER_HOUR` y `CAPTURA_LIMIT_PER_HOUR` (opcionales, límite por IP)

Sin la clave, la web funciona igual y el oráculo muestra "se activará muy pronto".

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
