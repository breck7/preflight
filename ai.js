(function () {
  const searchParams = new URLSearchParams(window.location.search);
  window.USE_MOCK_AI = searchParams.get("ai") !== "1";
  const API_TIMEOUT_MS = 45000;
  const TESSERACT_BASE = "/vendor/tesseract";
  const TESSERACT_URL = `${TESSERACT_BASE}/tesseract.min.js`;

  const AI_ENGINES = [
    { id: "local", label: "Local", provider: "local" },
    { id: "openai:gpt-5.5", label: "GPT-5.5", provider: "openai", model: "gpt-5.5" },
  ];

  const DEFAULT_AI_ENGINE = searchParams.get("engine") || searchParams.get("model") || "local";

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function validateGovernmentWarning(field) {
    const value = normalizeWhitespace(field.aiValue || field.userValue || "");

    if (!value.includes("GOVERNMENT WARNING:")) {
      return {
        ...field,
        status: field.status === "corrected" ? "corrected" : "invalid",
        message: "Heading must be \"GOVERNMENT WARNING:\" in ALL CAPS and bold.",
        suggestion: "GOVERNMENT WARNING:",
        checks: field.checks && field.checks.length
          ? field.checks
          : [{ id: "warning_heading_caps", status: "invalid", message: "Heading must be all caps and bold." }],
      };
    }

    return field;
  }

  function normalizeComparable(value) {
    return normalizeWhitespace(value).toLowerCase().replace(/[^\w%]+/g, "");
  }

  function validateReviewerMatch(field, applicationData) {
    if (!applicationData || !applicationData[field.id]) return field;
    const applicationValue = applicationData[field.id];
    const aiValue = field.aiValue || "";

    if (field.status === "invalid" || field.status === "warning") {
      return { ...field, applicationValue };
    }

    if (normalizeComparable(applicationValue) !== normalizeComparable(aiValue)) {
      return {
        ...field,
        applicationValue,
        status: "warning",
        message: "Application value and label text need reviewer confirmation.",
      };
    }

    return { ...field, applicationValue };
  }

  function validateField(field, mode, applicationData) {
    let next = normalizeFieldLabel(field);
    next = { ...next, box: normalizeFieldBox(next.box) };
    next = next.id === "governmentWarning" ? validateGovernmentWarning(next) : next;
    if (mode === "reviewer") next = validateReviewerMatch(next, applicationData);
    if (!next.box) {
      next = {
        ...next,
        status: next.aiValue || next.userValue ? next.status : "invalid",
        confidence: next.aiValue || next.userValue ? next.confidence : 0,
        message: next.aiValue || next.userValue ? "AI did not return a usable label location." : "Field was not found on the label.",
      };
    }
    return next;
  }

  function normalizeFieldLabel(field) {
    const labels = window.DISPLAY_LABELS || {};
    return {
      ...field,
      label: labels[field.id] || titleCaseFieldId(field.label || field.id),
    };
  }

  function titleCaseFieldId(value) {
    return normalizeWhitespace(value)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function normalizeFieldBox(box) {
    if (!box) return null;
    const raw = {
      x: Number(box.x),
      y: Number(box.y),
      w: Number(box.w),
      h: Number(box.h),
    };
    if (!Object.values(raw).every(Number.isFinite)) return null;

    const values = [raw.x, raw.y, raw.w, raw.h];
    const max = Math.max(...values.map(Math.abs));
    const scale = max > 1.5 && max <= 100 ? 100 : 1;
    const normalized = {
      x: raw.x / scale,
      y: raw.y / scale,
      w: raw.w / scale,
      h: raw.h / scale,
    };
    const x = clampNumber(normalized.x, 0, 0.98);
    const y = clampNumber(normalized.y, 0, 0.98);
    const w = clampNumber(normalized.w, 0.015, 1 - x);
    const h = clampNumber(normalized.h, 0.015, 1 - y);
    return { x, y, w, h };
  }

  function validateFields(fields, mode, applicationData) {
    return fields.map((field) => validateField(field, mode, applicationData));
  }

  function summarize(fields) {
    return fields.reduce(
      (summary, field) => {
        summary.total += 1;
        summary[field.status] = (summary[field.status] || 0) + 1;
        return summary;
      },
      { total: 0, valid: 0, warning: 0, invalid: 0, corrected: 0, unknown: 0 },
    );
  }

  function getEngine(engineId) {
    return AI_ENGINES.find((engine) => engine.id === engineId) || AI_ENGINES.find((engine) => engine.id === DEFAULT_AI_ENGINE) || AI_ENGINES[0];
  }

  function getAIEngineLabel(engineId) {
    return getEngine(engineId).label;
  }

  async function analyzeLabel(imageBase64, mode, applicationData, engineId) {
    const engine = getEngine(engineId);

    if (engine.id === "local") {
      const result = await analyzeWithTesseract(imageBase64, mode);
      result.fields = validateFields(result.fields, mode, applicationData);
      result.summary = summarize(result.fields);
      return result;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch("/api/analyze-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64,
          mode,
          model: engine.model,
          applicationData: mode === "reviewer" ? applicationData : null,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null);
        const detail = error && error.detail ? ` ${error.detail}` : "";
        throw new Error(error && error.error ? `${error.error}.${detail}` : `Analysis failed with ${response.status}`);
      }
      const result = await response.json();
      if (!result || !Array.isArray(result.fields)) throw new Error("Invalid analysis JSON.");
      result.fields = validateFields(result.fields, mode, applicationData);
      result.summary = summarize(result.fields);
      return result;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function getCachedLabelAnalysis(imageBase64, mode, applicationData, engineId) {
    const engine = getEngine(engineId);
    if (engine.provider !== "openai") return null;

    const response = await fetch("/api/analyze-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageBase64,
        mode,
        model: engine.model,
        applicationData: mode === "reviewer" ? applicationData : null,
        cacheOnly: true,
      }),
    });

    if (response.status === 404) return null;
    if (!response.ok) return null;
    const result = await response.json();
    if (!result || !Array.isArray(result.fields)) return null;
    result.fields = validateFields(result.fields, mode, applicationData);
    result.summary = summarize(result.fields);
    return result;
  }

  async function analyzeWithTesseract(imageBase64, mode) {
    if (!imageBase64) throw new Error("Local needs an image loaded in the browser.");
    await loadTesseract();
    const prepared = await prepareImageForOcr(imageBase64);
    const { data } = await window.Tesseract.recognize(prepared.src, "eng", {
      workerPath: `${TESSERACT_BASE}/worker.min.js`,
      corePath: TESSERACT_BASE,
      langPath: `${TESSERACT_BASE}/lang`,
      workerBlobURL: false,
      gzip: true,
      logger(message) {
        if (message.status === "recognizing text") {
          console.log(`Tesseract OCR ${Math.round((message.progress || 0) * 100)}%`);
        }
      },
    });
    const ocr = normalizeOcrResult(data, prepared.imageInfo);
    window.localOcrDebug = ocr;
    return { fields: buildLocalOcrFields(ocr, mode), summary: {} };
  }

  async function loadTesseract() {
    if (window.Tesseract) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TESSERACT_URL;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load local Tesseract.js."));
      document.head.appendChild(script);
    });
  }

  async function prepareImageForOcr(src) {
    const image = await loadImage(src);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    const scale = Math.min(2, 1800 / naturalWidth, 5200 / naturalHeight);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    boostContrast(imageData.data);
    context.putImageData(imageData, 0, 0);
    return {
      src: canvas.toDataURL("image/png"),
      imageInfo: { width, height },
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function boostContrast(data) {
    for (let index = 0; index < data.length; index += 4) {
      const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
      const contrast = clampNumber((gray - 128) * 1.35 + 128, 0, 255);
      data[index] = contrast;
      data[index + 1] = contrast;
      data[index + 2] = contrast;
      data[index + 3] = 255;
    }
  }

  function normalizeOcrResult(data, imageInfo) {
    const words = normalizeOcrWords(data, imageInfo);
    const lines = normalizeOcrLines(data, imageInfo, words);
    const candidates = makeOcrCandidates(lines, words);
    return { text: normalizeWhitespace(data.text || ""), lines, words, candidates };
  }

  function normalizeOcrWords(data, imageInfo) {
    const sourceWords = Array.isArray(data.words) ? data.words : [];
    return sourceWords
      .map((word) => ({
        text: cleanOcrText(word.text),
        confidence: Number.isFinite(word.confidence) ? Math.max(0, Math.min(1, word.confidence / 100)) : 0.55,
        box: bboxToBox(word.bbox, imageInfo),
      }))
      .filter((word) => word.text && word.box && word.confidence > 0.2);
  }

  function normalizeOcrLines(data, imageInfo, words) {
    const sourceLines = Array.isArray(data.lines) ? data.lines : [];
    const lines = sourceLines
      .map((line) => ({
        text: cleanOcrText(line.text),
        confidence: Number.isFinite(line.confidence) ? Math.max(0, Math.min(1, line.confidence / 100)) : 0.55,
        box: bboxToBox(line.bbox, imageInfo),
      }))
      .filter((line) => line.text && line.box);

    if (lines.length) return lines;

    if (words.length) return groupWordsIntoLines(words);

    const textLines = normalizeWhitespace(data.text || "").split(/(?<=\.)\s+|\n+/).filter(Boolean);
    return textLines.map((text, index) => ({
      text: cleanOcrText(text),
      confidence: 0.45,
      box: { x: 0.08, y: 0.1 + index * 0.08, w: 0.84, h: 0.055 },
    }));
  }

  function groupWordsIntoLines(words) {
    const rows = [];
    words
      .slice()
      .sort((a, b) => (a.box.y + a.box.h / 2) - (b.box.y + b.box.h / 2) || a.box.x - b.box.x)
      .forEach((word) => {
        const y = word.box.y + word.box.h / 2;
        const row = rows.find((candidate) => Math.abs(candidate.y - y) < Math.max(0.018, word.box.h * 0.75));
        if (row) {
          row.words.push(word);
          row.y = (row.y + y) / 2;
        } else {
          rows.push({ y, words: [word] });
        }
      });

    return rows.map((row) => wordsToCandidate(row.words)).filter(Boolean);
  }

  function makeOcrCandidates(lines, words) {
    const ngrams = [];
    groupWordsIntoLines(words).forEach((line) => {
      const lineWords = words
        .filter((word) => boxesOverlapY(word.box, line.box))
        .sort((a, b) => a.box.x - b.box.x);
      for (let start = 0; start < lineWords.length; start += 1) {
        for (let size = 1; size <= Math.min(8, lineWords.length - start); size += 1) {
          const candidate = wordsToCandidate(lineWords.slice(start, start + size));
          if (candidate) ngrams.push(candidate);
        }
      }
    });

    return [...lines, ...ngrams]
      .filter((candidate) => candidate.text)
      .sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  }

  function wordsToCandidate(words) {
    if (!words.length) return null;
    return {
      text: cleanOcrText(words.map((word) => word.text).join(" ")),
      confidence: words.reduce((sum, word) => sum + word.confidence, 0) / words.length,
      box: unionBoxes(words.map((word) => word.box)),
    };
  }

  function boxesOverlapY(a, b) {
    return Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) > Math.min(a.h, b.h) * 0.35;
  }

  function bboxToBox(bbox, imageInfo) {
    if (!bbox || !imageInfo.width || !imageInfo.height) return null;
    const x0 = Number(bbox.x0 ?? bbox.left ?? 0);
    const y0 = Number(bbox.y0 ?? bbox.top ?? 0);
    const x1 = Number(bbox.x1 ?? (bbox.left + bbox.width) ?? x0);
    const y1 = Number(bbox.y1 ?? (bbox.top + bbox.height) ?? y0);
    return {
      x: clampNumber(x0 / imageInfo.width, 0, 1),
      y: clampNumber(y0 / imageInfo.height, 0, 1),
      w: clampNumber((x1 - x0) / imageInfo.width, 0.02, 1),
      h: clampNumber((y1 - y0) / imageInfo.height, 0.02, 1),
    };
  }

  function buildLocalOcrFields(ocr) {
    const candidates = ocr.candidates;
    const text = ocr.text || candidates.map((line) => line.text).join("\n");
    const origin = findBestCandidate(candidates, {
      pattern: /\b(kentucky|california|new york|texas|oregon|france|italy|mexico|canada|ireland|scotland|usa|united states|sonoma|bardstown)\b/i,
      preferredY: [0.25, 0.9],
    });
    return [
      makeOcrField("brandName", "Brand Name", findBrandCandidate(candidates)),
      makeOcrField("classType", "Class / Type", findBestCandidate(candidates, {
        pattern: /(bourbon|whisk\w*|pinot|noir|wine|vodka|rum|gin|beer|tequila|liqueur|brandy)/i,
        preferredY: [0.12, 0.72],
      })),
      makeOcrField("alcoholContent", "Alcohol Content", findBestCandidate(candidates, {
        pattern: /\b(\d{1,2}(?:\.\d+)?\s*%\s*(?:alc|abv|alcohol|alc\.?\/?vol\.?)?|\d{2,3}\s*proof)\b/i,
        preferredY: [0.3, 0.95],
      })),
      makeOcrField("netContents", "Net Contents", findBestCandidate(candidates, {
        pattern: /\b\d+(?:\.\d+)?\s*(?:mL|ml|ML|liters?|litres?|L|oz|fl\.?\s*oz)\b/,
        reject: /\b(?:alc|alcohol|abv|proof)\b/i,
        preferredY: [0.42, 0.98],
      })),
      makeOcrField("bottlerProducer", "Bottler / Producer", findBestCandidate(candidates, {
        pattern: /\b(bottled|distilled|produced|imported|cellared|brewed|vinted|distillery|winery|wines|llc|inc)\b/i,
        preferredY: [0.45, 0.98],
      })),
      makeOcrField("productOrigin", "Product Origin", origin),
      makeOcrField("governmentWarning", "Government Warning", findBestCandidate(candidates, {
        pattern: /government\s+warning:?/i,
        preferredY: [0.45, 1],
      }), {
        fallbackText: /government/i.test(text) ? "Government warning text" : "",
      }),
    ];
  }

  function findBrandCandidate(candidates) {
    return candidates
      .filter((line) => (
        line.text.length > 2
        && line.box
        && line.text.length <= 42
        && line.box.y < 0.58
        && !/[0-9()]/.test(line.text)
        && !/\b(government|warning|ability|drive|pregnant|alc|alcohol|proof|ml|bottled|distilled|produced|bourbon|whiskey|whisky|pinot|noir|wine|vodka|rum|gin|beer|tequila|kentucky|california)\b/i.test(line.text)
      ))
      .sort((a, b) => brandScore(b) - brandScore(a))[0];
  }

  function brandScore(line) {
    const uppercaseRatio = line.text.replace(/[^A-Z]/g, "").length / Math.max(1, line.text.replace(/[^A-Za-z]/g, "").length);
    const centered = line.box ? 1 - Math.abs((line.box.x + line.box.w / 2) - 0.5) : 0;
    const topBias = line.box ? 1 - line.box.y : 0;
    return line.confidence + uppercaseRatio + centered + topBias * 0.6 + Math.min(line.text.length, 32) / 90;
  }

  function findBestCandidate(candidates, options) {
    return candidates
      .filter((candidate) => (
        candidate.box
        && options.pattern.test(candidate.text)
        && !(options.reject && options.reject.test(candidate.text))
        && (!options.preferredY || candidate.box.y >= options.preferredY[0] - 0.12)
        && (!options.preferredY || candidate.box.y <= options.preferredY[1] + 0.12)
      ))
      .map((candidate) => trimCandidateToMatch(candidate, options.pattern))
      .sort((a, b) => fieldCandidateScore(b, options) - fieldCandidateScore(a, options))[0];
  }

  function fieldCandidateScore(candidate, options) {
    const centerY = candidate.box.y + candidate.box.h / 2;
    const preferred = options.preferredY
      ? 1 - Math.min(1, distanceToRange(centerY, options.preferredY[0], options.preferredY[1]) * 4)
      : 0;
    const concise = 1 - Math.min(1, Math.max(0, candidate.text.length - 24) / 60);
    return candidate.confidence + preferred * 0.55 + concise * 0.9;
  }

  function trimCandidateToMatch(candidate, pattern) {
    const match = candidate.text.match(pattern);
    if (!match || !match[0] || match[0].length < 3) return candidate;
    const trimmed = cleanOcrText(expandUsefulMatch(candidate.text, match[0]));
    return trimmed && trimmed.length < candidate.text.length
      ? { ...candidate, text: trimmed }
      : candidate;
  }

  function expandUsefulMatch(text, match) {
    if (/\bproof\b/i.test(match)) {
      const proof = text.match(/\(?\s*\d{2,3}\s*proof\s*\)?/i);
      return proof ? proof[0] : match;
    }
    if (/%/.test(match)) {
      const abv = text.match(/\d{1,2}(?:\.\d+)?\s*%\s*(?:alc\.?\/?vol\.?|alc|abv|alcohol)?/i);
      return abv ? abv[0] : match;
    }
    if (/\b(?:ml|liter|litre|oz|fl)/i.test(match)) {
      const net = text.match(/\d+(?:\.\d+)?\s*(?:mL|ml|ML|liters?|litres?|L|oz|fl\.?\s*oz)\b/);
      return net ? net[0] : match;
    }
    return match;
  }

  function distanceToRange(value, min, max) {
    if (value < min) return min - value;
    if (value > max) return value - max;
    return 0;
  }

  function makeOcrField(id, label, line, options = {}) {
    const value = line ? line.text : options.fallbackText || "";
    const confidence = line ? line.confidence : 0;
    return {
      id,
      label,
      required: id !== "productOrigin",
      aiValue: value || null,
      applicationValue: null,
      userValue: null,
      status: value ? (confidence >= 0.72 ? "valid" : "warning") : "invalid",
      confidence,
      box: line && line.box ? line.box : null,
      message: value ? "Local found this text; confirm before relying on it." : "Local did not find this field.",
      suggestion: "",
      checks: [],
    };
  }

  function clampNumber(value, min, max) {
    return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
  }

  function unionBoxes(boxes) {
    const usable = boxes.filter(Boolean);
    if (!usable.length) return null;
    const x0 = Math.min(...usable.map((box) => box.x));
    const y0 = Math.min(...usable.map((box) => box.y));
    const x1 = Math.max(...usable.map((box) => box.x + box.w));
    const y1 = Math.max(...usable.map((box) => box.y + box.h));
    return {
      x: clampNumber(x0, 0, 1),
      y: clampNumber(y0, 0, 1),
      w: clampNumber(x1 - x0, 0.02, 1),
      h: clampNumber(y1 - y0, 0.02, 1),
    };
  }

  function cleanOcrText(value) {
    return normalizeWhitespace(value)
      .replace(/[|{}[\]_=~]+/g, " ")
      .replace(/\s+([:;,.%])/g, "$1")
      .replace(/\bGOVERNMENT\s+WARNING\b/i, "GOVERNMENT WARNING")
      .trim();
  }

  window.normalizeWhitespace = normalizeWhitespace;
  window.validateFields = validateFields;
  window.AI_ENGINES = AI_ENGINES;
  window.DEFAULT_AI_ENGINE = DEFAULT_AI_ENGINE;
  window.getAIEngineLabel = getAIEngineLabel;
  window.analyzeLabel = analyzeLabel;
  window.getCachedLabelAnalysis = getCachedLabelAnalysis;
})();
