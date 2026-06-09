const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const analyzeLabel = require("./api/analyze-label");

const root = __dirname;
const port = Number(process.env.PORT || 8000);

loadDotEnv(path.join(root, ".env"));

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return;
    const key = match[1];
    const value = match[2].replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  if (req.url.startsWith("/api/health")) {
    sendJson(res, 200, {
      ok: true,
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
      model: process.env.OPENAI_VISION_MODEL || "gpt-4o-mini",
      imageDetail: process.env.OPENAI_IMAGE_DETAIL || "low",
      maxOutputTokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 1200),
    });
    return;
  }

  if (req.url.startsWith("/api/debug/logs")) {
    const logPath = path.join(root, "logs", "openai-debug.ndjson");
    if (!fs.existsSync(logPath)) {
      sendJson(res, 200, { records: [] });
      return;
    }

    const lines = fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/).filter(Boolean);
    const records = lines.slice(-50).map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { parseError: error.message, line };
      }
    });
    sendJson(res, 200, { records });
    return;
  }

  if (req.url.startsWith("/api/analyze-label")) {
    try {
      req.body = await readJson(req);
      await analyzeLabel(req, {
        status(statusCode) {
          this.statusCode = statusCode;
          return this;
        },
        json(data) {
          sendJson(res, this.statusCode || 200, data);
        },
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  sendJson(res, 404, { error: "API route not found." });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(root, relativePath));

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  serveStatic(req, res);
});

server.listen(port, () => {
  const mode = process.env.OPENAI_API_KEY ? "AI API ready" : "mock only until OPENAI_API_KEY is set";
  console.log(`COLA Preflight server running at http://localhost:${port} (${mode})`);
});
