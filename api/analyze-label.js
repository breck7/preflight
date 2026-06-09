const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const IS_VERCEL = process.env.VERCEL === "1";
const RUNTIME_ROOT = IS_VERCEL ? "/tmp/cola-preflight" : path.join(__dirname, "..");
const LOG_DIR = process.env.COLA_LOG_DIR || path.join(RUNTIME_ROOT, "logs");
const DEBUG_LOG_PATH = path.join(LOG_DIR, "openai-debug.ndjson");
const CACHE_DIR = process.env.COLA_CACHE_DIR || path.join(RUNTIME_ROOT, "cache", "openai-label-analysis");
const CACHE_VERSION = "cola-preflight-v5-visible-text-boxes";
const CACHE_TTL_SECONDS = Number(process.env.COLA_CACHE_TTL_SECONDS || 60 * 60 * 24 * 14);
const KV_REST_API_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.COLAPREFLIGHT_KV_REST_API_URL || "";
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.COLAPREFLIGHT_KV_REST_API_TOKEN || "";
const ALLOWED_OPENAI_MODELS = new Set([
  "gpt-5.5",
]);

const FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          required: { type: "boolean" },
          aiValue: { type: ["string", "null"] },
          applicationValue: { type: ["string", "null"] },
          userValue: { type: ["string", "null"] },
          status: { type: "string", enum: ["valid", "warning", "invalid", "unknown"] },
          confidence: { type: "number" },
          box: {
            type: ["object", "null"],
            additionalProperties: false,
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number" },
              h: { type: "number" },
            },
            required: ["x", "y", "w", "h"],
          },
          message: { type: "string" },
          suggestion: { type: "string" },
          checks: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                status: { type: "string", enum: ["valid", "warning", "invalid", "unknown"] },
                message: { type: "string" },
              },
              required: ["id", "status", "message"],
            },
          },
        },
        required: [
          "id",
          "label",
          "required",
          "aiValue",
          "applicationValue",
          "userValue",
          "status",
          "confidence",
          "box",
          "message",
          "suggestion",
          "checks",
        ],
      },
    },
    summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        total: { type: "number" },
        valid: { type: "number" },
        warning: { type: "number" },
        invalid: { type: "number" },
        corrected: { type: "number" },
      },
      required: ["total", "valid", "warning", "invalid", "corrected"],
    },
  },
  required: ["fields", "summary"],
};

const PROMPT = `Extract alcohol label fields for COLA preflight.

Required ids: brandName, classType, alcoholContent, netContents, bottlerProducer, productOrigin, governmentWarning.

For each visible field return exact text, status, confidence, and a normalized box.
Box coordinates must be decimals from 0 to 1 relative to the full submitted image:
x = left / image width, y = top / image height, w = width / image width, h = height / image height.
Never return percentages such as 40 or 75; return 0.40 or 0.75 instead.
The box must tightly enclose the exact visible text you extracted. Do not point at a nearby logo, barcode, blank area, or a different occurrence.
Do not infer values from COLA metadata, common bottle sizes, or product context. If the exact text is not visibly readable, set aiValue null, box null, and status unknown or invalid.
For net contents, read the visible container size exactly, including values such as 50 mL, 375 mL, 750 mL, or 1 L. Do not assume 750 mL.
Use short messages. Use empty message and suggestion when no issue.
Use warning or unknown if uncertain. Do not invent text.

Government warning rule: heading must include exactly GOVERNMENT WARNING:
If it is missing, title case, or lacks the colon, mark governmentWarning invalid and suggest GOVERNMENT WARNING:

Reviewer mode: compare application value to label value with forgiving capitalization/punctuation normalization.`;

function makeRequestId() {
  return `cola_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED_API_KEY]")
      .replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g, "[REDACTED_IMAGE_DATA_URL]");
  }

  if (Array.isArray(value)) return value.map(redact);

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (/authorization|api[_-]?key|imageBase64|image_url/i.test(key)) return [key, "[REDACTED]"];
      return [key, redact(entry)];
    }));
  }

  return value;
}

function appendDebugLog(record) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(DEBUG_LOG_PATH, `${JSON.stringify(redact({ at: new Date().toISOString(), ...record }))}\n`);
  } catch (error) {
    console.error("Could not write OpenAI debug log", error.message);
  }
}

function summarizeOpenAIResponse(data) {
  return {
    id: data.id,
    model: data.model,
    status: data.status,
    usage: data.usage,
    outputTypes: Array.isArray(data.output)
      ? data.output.map((item) => ({
        id: item.id,
        type: item.type,
        status: item.status,
        role: item.role,
        contentTypes: Array.isArray(item.content) ? item.content.map((content) => content.type) : [],
      }))
      : [],
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function makeCacheKey({ imageBase64, mode, applicationData, model, imageDetail, maxOutputTokens }) {
  return sha256(stableStringify({
    version: CACHE_VERSION,
    prompt: sha256(PROMPT),
    schema: sha256(stableStringify(FIELD_SCHEMA)),
    image: sha256(imageBase64),
    mode,
    applicationData: applicationData || null,
    model,
    imageDetail,
    maxOutputTokens,
  }));
}

function cachePathForKey(cacheKey) {
  return path.join(CACHE_DIR, `${cacheKey}.json`);
}

function kvEnabled() {
  return Boolean(KV_REST_API_URL && KV_REST_API_TOKEN);
}

function kvCacheKey(cacheKey) {
  return `cola-preflight:${CACHE_VERSION}:${cacheKey}`;
}

async function kvCommand(command) {
  if (!kvEnabled()) return null;
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

async function readKvCache(cacheKey) {
  try {
    const result = await kvCommand(["GET", kvCacheKey(cacheKey)]);
    if (!result) return null;
    const parsed = typeof result === "string" ? JSON.parse(result) : result;
    return { ...parsed, cacheBackend: "kv" };
  } catch (error) {
    appendDebugLog({ stage: "kv_cache_read_error", cacheKey, error: error.message });
    return null;
  }
}

async function writeKvCache(cacheKey, payload) {
  try {
    const body = JSON.stringify({
      cacheVersion: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      payload,
    });
    await kvCommand(["SET", kvCacheKey(cacheKey), body, "EX", CACHE_TTL_SECONDS]);
    return true;
  } catch (error) {
    appendDebugLog({ stage: "kv_cache_write_error", cacheKey, error: error.message });
    return false;
  }
}

function readDiskCache(cacheKey) {
  try {
    const cachePath = cachePathForKey(cacheKey);
    if (!fs.existsSync(cachePath)) return null;
    return { ...JSON.parse(fs.readFileSync(cachePath, "utf8")), cacheBackend: IS_VERCEL ? "tmp" : "disk" };
  } catch (error) {
    appendDebugLog({ stage: "cache_read_error", cacheKey, error: error.message });
    return null;
  }
}

function writeDiskCache(cacheKey, payload) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cachePath = cachePathForKey(cacheKey);
    fs.writeFileSync(cachePath, JSON.stringify({
      cacheVersion: CACHE_VERSION,
      cachedAt: new Date().toISOString(),
      payload,
    }, null, 2));
    return true;
  } catch (error) {
    appendDebugLog({ stage: "cache_write_error", cacheKey, error: error.message });
    return false;
  }
}

async function readCache(cacheKey) {
  return await readKvCache(cacheKey) || readDiskCache(cacheKey);
}

async function writeCache(cacheKey, payload) {
  const kvStored = await writeKvCache(cacheKey, payload);
  const diskStored = writeDiskCache(cacheKey, payload);
  return {
    kvStored,
    diskStored,
    backend: kvStored ? "kv" : diskStored ? IS_VERCEL ? "tmp" : "disk" : "none",
  };
}

module.exports = async function handler(req, res) {
  const requestId = makeRequestId();
  const startedAt = Date.now();

  if (req.method !== "POST") {
    appendDebugLog({ requestId, stage: "reject_method", method: req.method });
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { imageBase64, mode, applicationData, model: requestedModel, cacheOnly } = req.body || {};
  if (!imageBase64 || !String(imageBase64).startsWith("data:image/")) {
    appendDebugLog({ requestId, stage: "reject_bad_image", mode: mode || "applicant" });
    res.status(400).json({ error: "imageBase64 data URL is required." });
    return;
  }

  const fallbackModel = process.env.OPENAI_VISION_MODEL || "gpt-5.5";
  const model = ALLOWED_OPENAI_MODELS.has(requestedModel) ? requestedModel : fallbackModel;
  const imageDetail = process.env.OPENAI_IMAGE_DETAIL || "auto";
  const maxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 1200);
  const normalizedMode = mode || "applicant";
  const imageBytesApprox = Math.round(String(imageBase64).length * 0.75);
  const cacheKey = makeCacheKey({
    imageBase64,
    mode: normalizedMode,
    applicationData,
    model,
    imageDetail,
    maxOutputTokens,
  });
  const requestMeta = {
    requestId,
    mode: normalizedMode,
    imageBytesApprox,
    model,
    imageDetail,
    cacheKey,
  };

  console.log("Analyze label request", requestMeta);
  appendDebugLog({
    stage: "request_start",
    cacheBackend: kvEnabled() ? "kv+tmp" : IS_VERCEL ? "tmp" : "disk",
    ...requestMeta,
  });

  const cached = await readCache(cacheKey);
  if (cached && cached.payload && Array.isArray(cached.payload.fields)) {
    const latencyMs = Date.now() - startedAt;
    appendDebugLog({
      requestId,
      stage: "cache_hit",
      latencyMs,
      cacheKey,
      cacheBackend: cached.cacheBackend,
      fieldCount: cached.payload.fields.length,
      cachedAt: cached.cachedAt,
    });
    res.status(200).json({
      ...cached.payload,
      requestId,
      debug: {
        ...(cached.payload.debug || {}),
        latencyMs,
        model,
        cache: "hit",
        cacheBackend: cached.cacheBackend,
        cachedAt: cached.cachedAt,
      },
    });
    return;
  }

  appendDebugLog({ requestId, stage: "cache_miss", cacheKey });

  if (cacheOnly) {
    res.status(404).json({
      requestId,
      error: "Cache miss.",
      debug: {
        latencyMs: Date.now() - startedAt,
        model,
        cache: "miss",
        cacheOnly: true,
      },
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    appendDebugLog({ requestId, stage: "reject_missing_key" });
    res.status(500).json({ error: "OPENAI_API_KEY is not configured." });
    return;
  }

  try {
    const openAIStartedAt = Date.now();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: `${PROMPT}\n\nMode: ${normalizedMode}\nApplication data: ${JSON.stringify(applicationData || null)}` },
              { type: "input_image", image_url: imageBase64, detail: imageDetail },
            ],
          },
        ],
        max_output_tokens: maxOutputTokens,
        ...(model.startsWith("gpt-5") ? { reasoning: { effort: "low" } } : {}),
        text: {
          format: {
            type: "json_schema",
            name: "cola_preflight_analysis",
            strict: true,
            schema: FIELD_SCHEMA,
          },
        },
      }),
    });
    const openAILatencyMs = Date.now() - openAIStartedAt;

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI vision analysis failed", response.status, errorText.slice(0, 1000));
      appendDebugLog({
        requestId,
        stage: "openai_http_error",
        httpStatus: response.status,
        latencyMs: Date.now() - startedAt,
        openAILatencyMs,
        errorText: errorText.slice(0, 4000),
      });
      res.status(response.status).json({ requestId, error: "Vision analysis failed.", detail: errorText.slice(0, 500) });
      return;
    }

    const data = await response.json();
    appendDebugLog({
      requestId,
      stage: "openai_response",
      httpStatus: response.status,
      openAILatencyMs,
      response: summarizeOpenAIResponse(data),
    });

    const output = data.output_text || (data.output || [])
      .flatMap((item) => item.content || [])
      .find((item) => item.type === "output_text")?.text;

    if (!output) {
      console.error("OpenAI response missing output_text", JSON.stringify(data).slice(0, 1000));
      appendDebugLog({
        requestId,
        stage: "missing_output_text",
        latencyMs: Date.now() - startedAt,
        response: data,
      });
      res.status(502).json({ requestId, error: "Model returned no JSON text." });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(output);
    } catch (error) {
      appendDebugLog({
        requestId,
        stage: "json_parse_error",
        latencyMs: Date.now() - startedAt,
        error: error.message,
        output: output.slice(0, 4000),
      });
      res.status(502).json({ requestId, error: "Model returned invalid JSON.", detail: error.message });
      return;
    }

    appendDebugLog({
      requestId,
      stage: "success",
      latencyMs: Date.now() - startedAt,
      fieldCount: Array.isArray(parsed.fields) ? parsed.fields.length : null,
      summary: parsed.summary,
      fields: Array.isArray(parsed.fields)
        ? parsed.fields.map((field) => ({
          id: field.id,
          status: field.status,
          confidence: field.confidence,
          aiValue: field.aiValue,
          hasBox: Boolean(field.box),
        }))
        : null,
    });

    const payload = { ...parsed, debug: { latencyMs: Date.now() - startedAt, model, cache: "miss" } };
    const cacheWrite = await writeCache(cacheKey, payload);
    res.status(200).json({
      ...payload,
      requestId,
      debug: {
        ...payload.debug,
        cacheWrite,
      },
    });
  } catch (error) {
    console.error("Could not analyze label", error);
    appendDebugLog({
      requestId,
      stage: "exception",
      latencyMs: Date.now() - startedAt,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        cause: error.cause ? {
          name: error.cause.name,
          message: error.cause.message,
          code: error.cause.code,
        } : null,
      },
    });
    res.status(500).json({ requestId, error: "Could not analyze label.", detail: error.message });
  }
};
