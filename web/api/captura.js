// POST /api/captura  { image: <base64 sin prefijo>, media_type }  ->  { names: [...] }
// Lee los nombres de los jugadores de una captura de pantalla de la plantilla.
import { MODEL, getClient, rateLimited, sendJSON, textOf, apiErrorStatus } from "./_lib.js";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SCHEMA = {
  type: "object",
  properties: { players: { type: "array", items: { type: "string" } } },
  required: ["players"],
  additionalProperties: false,
};

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJSON(res, 405, { error: "method" });
  const client = getClient();
  if (!client) return sendJSON(res, 503, { error: "not_configured", message: "La lectura de capturas se activará muy pronto." });
  if (rateLimited(req, Number(process.env.CAPTURA_LIMIT_PER_HOUR || 6), 3600e3)) {
    return sendJSON(res, 429, { error: "rate_limited", message: "Demasiadas capturas seguidas. Vuelve en un rato." });
  }
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const mediaType = String(body.media_type || "image/jpeg");
  const image = String(body.image || "");
  if (!TYPES.has(mediaType) || image.length < 100 || image.length > 4_000_000) {
    return sendJSON(res, 400, { error: "image", message: "La imagen no es válida o es demasiado grande." });
  }

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
          { type: "text", text: "Es una captura de pantalla de una plantilla de un juego fantasy de fútbol. Devuelve en \"players\" los nombres de los futbolistas que aparecen, tal y como se ven escritos, sin repetir. Si no hay futbolistas, devuelve una lista vacía." },
        ],
      }],
    });
    if (response.stop_reason === "refusal") return sendJSON(res, 200, { names: [] });
    let names = [];
    try { names = JSON.parse(textOf(response)).players || []; } catch { names = []; }
    return sendJSON(res, 200, { names: names.map((n) => String(n).slice(0, 60)).slice(0, 40) });
  } catch (err) {
    console.error("captura", err);
    const [status, message] = apiErrorStatus(err);
    return sendJSON(res, status, { error: "api", message });
  }
}
