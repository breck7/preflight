const fs = require("fs");
const path = require("path");

const IS_VERCEL = process.env.VERCEL === "1";
const RUNTIME_ROOT = IS_VERCEL ? "/tmp/cola-preflight" : path.join(__dirname, "..");
const CACHE_DIR = process.env.COLA_CACHE_DIR || path.join(RUNTIME_ROOT, "cache", "openai-label-analysis");
const CACHE_VERSION = "cola-preflight-v5-visible-text-boxes";
const KV_REST_API_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.COLAPREFLIGHT_KV_REST_API_URL || "";
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.COLAPREFLIGHT_KV_REST_API_TOKEN || "";
const KV_PREFIX = `cola-preflight:${CACHE_VERSION}:`;

function kvEnabled() {
  return Boolean(KV_REST_API_URL && KV_REST_API_TOKEN);
}

async function kvCommand(command) {
  const response = await fetch(KV_REST_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.error) {
    throw new Error(data && data.error ? data.error : `KV request failed with ${response.status}`);
  }
  return data.result;
}

function summarizePayload(entry, source, key) {
  const payload = entry && entry.payload ? entry.payload : {};
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  return {
    key,
    source,
    cacheVersion: entry.cacheVersion || null,
    cachedAt: entry.cachedAt || null,
    model: payload.debug && payload.debug.model ? payload.debug.model : null,
    cache: payload.debug && payload.debug.cache ? payload.debug.cache : null,
    summary: payload.summary || null,
    fieldCount: fields.length,
    fields: fields.map((field) => ({
      id: field.id,
      status: field.status,
      aiValue: field.aiValue,
      hasBox: Boolean(field.box),
    })),
  };
}

async function listKvEntries(limit) {
  if (!kvEnabled()) return { enabled: false, entries: [], error: null };

  try {
    let cursor = "0";
    const keys = [];
    do {
      const result = await kvCommand(["SCAN", cursor, "MATCH", `${KV_PREFIX}*`, "COUNT", "100"]);
      cursor = String(result && result[0] !== undefined ? result[0] : "0");
      const batch = Array.isArray(result && result[1]) ? result[1] : [];
      keys.push(...batch);
    } while (cursor !== "0" && keys.length < limit);

    const limitedKeys = keys.slice(0, limit);
    const entries = [];
    for (const key of limitedKeys) {
      const raw = await kvCommand(["GET", key]);
      if (!raw) continue;
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      entries.push(summarizePayload(parsed, "kv", String(key).replace(KV_PREFIX, "")));
    }
    return { enabled: true, entries, error: null };
  } catch (error) {
    return { enabled: true, entries: [], error: error.message };
  }
}

function listDiskEntries(limit) {
  try {
    if (!fs.existsSync(CACHE_DIR)) return { enabled: true, entries: [], error: null };
    const files = fs.readdirSync(CACHE_DIR)
      .filter((file) => file.endsWith(".json"))
      .slice(0, limit);
    const entries = files.map((file) => {
      const parsed = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), "utf8"));
      return summarizePayload(parsed, IS_VERCEL ? "tmp" : "disk", file.replace(/\.json$/, ""));
    });
    return { enabled: true, entries, error: null };
  } catch (error) {
    return { enabled: true, entries: [], error: error.message };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store");
  }

  const limit = Math.max(1, Math.min(250, Number(req.query && req.query.limit) || 100));
  const [kv, disk] = await Promise.all([
    listKvEntries(limit),
    Promise.resolve(listDiskEntries(limit)),
  ]);
  const entries = [...kv.entries, ...disk.entries]
    .sort((a, b) => String(b.cachedAt || "").localeCompare(String(a.cachedAt || "")))
    .slice(0, limit);

  res.status(200).json({
    ok: true,
    cacheVersion: CACHE_VERSION,
    generatedAt: new Date().toISOString(),
    kv: {
      enabled: kv.enabled,
      error: kv.error,
      count: kv.entries.length,
    },
    disk: {
      dir: CACHE_DIR,
      source: IS_VERCEL ? "tmp" : "disk",
      error: disk.error,
      count: disk.entries.length,
    },
    count: entries.length,
    entries,
  });
};
