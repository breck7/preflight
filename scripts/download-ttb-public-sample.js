#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");

// TTB's public COLAs host can present an incomplete chain to Node's fetch.
// This script only downloads public registry fixtures; the app runtime does not use this.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const BASE_URL = "https://www.ttbonline.gov/colasonline";
const DEFAULT_FROM = "06/01/2026";
const DEFAULT_TO = "06/08/2026";
const DEFAULT_LIMIT = 100;
const DEFAULT_OUT_DIR = path.join("test-images", "ttb-public-sample");

const args = parseArgs(process.argv.slice(2));
const dateFrom = args.from || DEFAULT_FROM;
const dateTo = args.to || DEFAULT_TO;
const limit = Number(args.limit || DEFAULT_LIMIT);
const outDir = args.out || DEFAULT_OUT_DIR;

let cookieJar = new Map();

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  await request(`${BASE_URL}/publicSearchColasBasic.do`);
  const searchBody = new URLSearchParams({
    "searchCriteria.dateCompletedFrom": dateFrom,
    "searchCriteria.dateCompletedTo": dateTo,
    "searchCriteria.productOrFancifulName": "",
    "searchCriteria.productNameSearchType": "E",
    "searchCriteria.classTypeFrom": "",
    "searchCriteria.classTypeTo": "",
    "searchCriteria.originCode": "",
  });
  await request(`${BASE_URL}/publicSearchColasBasicProcess.do?action=search`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: searchBody.toString(),
  });

  const csv = await requestText(`${BASE_URL}/publicSaveSearchResultsToFile.do?path=/publicSearchColasBasicProcess`);
  await fs.writeFile(path.join(outDir, "source-search.csv"), csv);

  const rows = parseCsv(csv).slice(0, limit);
  const submissions = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const ttbId = row["TTB ID"].replace(/^'|'$/g, "");
    const dir = path.join(outDir, `${String(index + 1).padStart(3, "0")}-${ttbId}`);
    await fs.mkdir(dir, { recursive: true });

    const detailHtml = await requestText(`${BASE_URL}/viewColaDetails.do?action=publicFormDisplay&ttbid=${ttbId}`);
    await fs.writeFile(path.join(dir, "detail.html"), detailHtml);

    const attachments = extractLabelAttachments(detailHtml);
    const downloaded = [];

    for (let imageIndex = 0; imageIndex < attachments.length; imageIndex += 1) {
      const attachment = attachments[imageIndex];
      const sourceUrl = absoluteUrl(attachment.href);
      const ext = extensionFromFilename(attachment.filename);
      const label = slug(attachment.label || `label-${imageIndex + 1}`);
      const filename = `${String(imageIndex + 1).padStart(2, "0")}-${label}${ext}`;
      const bytes = await requestBytes(sourceUrl);
      await fs.writeFile(path.join(dir, filename), bytes);
      downloaded.push({ ...attachment, sourceUrl, file: filename, bytes: bytes.length });
    }

    const metadata = {
      source: "TTB Public COLA Registry",
      sourceUrl: `${BASE_URL}/viewColaDetails.do?action=publicFormDisplay&ttbid=${ttbId}`,
      sampledAt: new Date().toISOString(),
      search: { dateCompletedFrom: dateFrom, dateCompletedTo: dateTo },
      row,
      ttbId,
      imageCount: downloaded.length,
      images: downloaded,
    };
    await fs.writeFile(path.join(dir, "metadata.json"), JSON.stringify(metadata, null, 2));
    submissions.push({ ...metadata, folder: path.basename(dir) });
    console.log(`${index + 1}/${rows.length} ${ttbId}: ${downloaded.length} image(s)`);
    await sleep(75);
  }

  const histogram = submissions.reduce((counts, item) => {
    counts[item.imageCount] = (counts[item.imageCount] || 0) + 1;
    return counts;
  }, {});
  const index = {
    source: "TTB Public COLA Registry",
    sampledAt: new Date().toISOString(),
    search: { dateCompletedFrom: dateFrom, dateCompletedTo: dateTo },
    requestedLimit: limit,
    downloadedSubmissions: submissions.length,
    histogram,
    submissions: submissions.map((item) => ({
      ttbId: item.ttbId,
      imageCount: item.imageCount,
      folder: item.folder,
      brandName: item.row["Brand Name"],
      fancifulName: item.row["Fanciful Name"],
      classType: item.row["Class/Type Desc"],
      completedDate: item.row["Completed Date"],
      images: item.images.map((image) => image.file),
    })),
  };
  await fs.writeFile(path.join(outDir, "index.json"), JSON.stringify(index, null, 2));
  console.log(`Done: ${submissions.length} submissions in ${outDir}`);
  console.log(`Histogram: ${JSON.stringify(histogram)}`);
}

function parseArgs(values) {
  const parsed = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith("--")) continue;
    parsed[value.slice(2)] = values[i + 1];
    i += 1;
  }
  return parsed;
}

async function requestText(url, options) {
  const response = await request(url, options);
  return response.text();
}

async function requestBytes(url, options) {
  const response = await request(url, options);
  return Buffer.from(await response.arrayBuffer());
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Cookie: cookieHeader(),
      "User-Agent": "COLA Preflight test fixture downloader",
    },
  });
  rememberCookies(response.headers);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response;
}

function rememberCookies(headers) {
  const cookies = headers.getSetCookie ? headers.getSetCookie() : [];
  for (const cookie of cookies) {
    const [pair] = cookie.split(";");
    const [name, value] = pair.split("=");
    if (name && value) cookieJar.set(name, value);
  }
}

function cookieHeader() {
  return [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ");
}

function parseCsv(csv) {
  const rows = csv.trim().split(/\r?\n/).map(parseCsvLine);
  const headers = rows.shift();
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function extractLabelAttachments(html) {
  const attachments = [];
  const regex = /<img\s+[^>]*src="([^"]*publicViewAttachment\.do\?filename=([^"&]+)&filetype=l)"[^>]*alt="Label Image:\s*([^"]*)"[^>]*>/gi;
  let match;
  while ((match = regex.exec(html))) {
    attachments.push({
      href: decodeHtml(match[1]),
      filename: decodeURIComponent(decodeHtml(match[2])),
      label: decodeHtml(match[3]),
    });
  }
  return attachments;
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x2f;/gi, "/")
    .replace(/&#x28;/gi, "(")
    .replace(/&#x29;/gi, ")")
    .replace(/&nbsp;/g, " ");
}

function extensionFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ext && ext.length <= 6 ? ext : ".jpg";
}

function absoluteUrl(href) {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `https://www.ttbonline.gov${href}`;
  return `${BASE_URL}/${href}`;
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "label";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
