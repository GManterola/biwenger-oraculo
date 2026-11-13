// Utilidades compartidas por las funciones de Vercel (los archivos que empiezan por _ no son endpoints).
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.ORACULO_MODEL || "claude-opus-5-5";
const POS = { POR: "portero", DEF: "defensa", MED: "centrocampista", DEL: "delantero", ENT: "entrenador" };
const STATUS = { ok: "disponible", doubt: "duda", warned: "apercibido", injured: "lesionado", sanctioned: "sancionado", discarded: "descartado" };

let client = null;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic();
  return client;
}

// Límite sencillo por IP y por instancia (protege de abusos casuales; el tope real de gasto se pone en la consola de Anthropic).
const hits = new Map();
export function rateLimited(req, max, windowMs) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) return true;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

let cache = { at: 0, data: null };
export async function loadData(req) {
  if (cache.data && Date.now() - cache.at < 10 * 60 * 1000) return cache.data;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const res = await fetch(`https://${host}/data/la-liga.json`);
  if (!res.ok) throw new Error(`datos ${res.status}`);
  cache = { at: Date.now(), data: await res.json() };
  return cache.data;
}

export const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const m = (v) => v == null ? "?" : (v / 1e6).toFixed(2).replace(".", ",") + " M";
const pct = (x) => x == null ? "?" : Math.round(x * 100) + " %";

export function playerLine(d, p, score) {
  const s = p.scores[score] || p.scores[String(d.primaryScore)] || {};
  const team = d.teams[p.team]?.name ?? "?";
  const nx = d.teams[p.team]?.next;
  const opp = nx ? `${nx.home ? "en casa ante" : "fuera ante"} ${d.teams[nx.opp]?.name ?? "?"}` : "sin partido";
  const fit = [...(s.fit || [])].reverse().map((x) => typeof x === "number" ? x : x == null ? "no jugó" : STATUS[x] || x).join(", ");
  const inc = p.inc ? `${p.inc > 0 ? "+" : "-"}${Math.round(Math.abs(p.inc) / 1000)}k hoy` : "sin cambio hoy";
  return `- ${p.name} (${team}, ${POS[p.pos] || p.pos}) | precio ${m(p.price)} (${inc}) | estado: ${STATUS[p.status] || p.status}${p.info ? ` (${p.info})` : ""}`
    + (p.pPlay != null ? ` | juega: ${pct(p.pPlay)} | buen partido: ${pct(s.pGood)} | puntos esperados: ${s.xp ?? "?"}` : "")
    + ` | puntos: ${s.pts ?? 0} en ${p.played} partidos (media ${s.avg ?? "?"}) | últimas 5 jornadas (antigua→reciente): ${fit || "sin datos"} | próximo: ${opp}`;
}

export function sendJSON(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function textOf(response) {
  return response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

export function apiErrorStatus(err) {
  if (err instanceof Anthropic.RateLimitError) return [429, "El oráculo está saturado. Prueba en un minuto."];
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return [503, "El oráculo no está bien configurado."];
  if (err instanceof Anthropic.BadRequestError) return [400, "No hemos podido procesar la pregunta."];
  if (err instanceof Anthropic.APIError) return [502, "El oráculo no responde ahora mismo. Inténtalo más tarde."];
  return [500, "Error inesperado."];
}
