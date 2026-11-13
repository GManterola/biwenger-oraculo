// Convierte las tarjetas HTML de build/cards en imágenes PNG (1200x675, JPEG) en web/x/.
// Uso: node site/scripts/render_cards.mjs
import { createRequire } from "node:module";
import { readdirSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");

const root = resolve(import.meta.dirname, "..", "..");
const cards = join(root, "build", "cards");
const out = join(root, "web", "x");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 675 } });
for (const f of readdirSync(cards).filter((n) => n.endsWith(".html"))) {
  await page.goto(pathToFileURL(join(cards, f)).href);
  await page.screenshot({ path: join(out, f.replace(/\.html$/, ".jpg")), type: "jpeg", quality: 88 });
  console.log("imagen:", f.replace(/\.html$/, ".jpg"));
}
await browser.close();
