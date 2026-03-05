#!/usr/bin/env node
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAttributionMarkdown,
  getAssetManifest,
  validateManifest
} from "./import-assets-lib.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, "../public/assets/models");
const attributionPath = path.join(outputDir, "ATTRIBUTION.md");

const force = process.argv.includes("--force");
const manifest = getAssetManifest();
const validationErrors = validateManifest(manifest);

if (validationErrors.length > 0) {
  console.error("Asset manifest validation failed:");
  for (const error of validationErrors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });

async function downloadWithRetry(url, retries = 2) {
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength === 0) {
        throw new Error(`Downloaded zero bytes from ${url}`);
      }
      return Buffer.from(bytes);
    } catch (error) {
      lastError = error;
      if (attempt <= retries) {
        console.warn(`[import-assets] retry ${attempt}/${retries} for ${url}`);
      }
    }
  }
  throw lastError;
}

let downloaded = 0;
let failed = 0;

for (const entry of manifest) {
  const targetPath = path.join(outputDir, entry.fileName);
  try {
    if (!force) {
      try {
        await stat(targetPath);
        console.log(`[import-assets] skip existing ${entry.fileName} (use --force to refresh)`);
        continue;
      } catch {
        // missing file, continue to download
      }
    }

    const buffer = await downloadWithRetry(entry.url);
    await writeFile(targetPath, buffer);
    downloaded += 1;
    console.log(`[import-assets] saved ${entry.fileName} (${buffer.length} bytes)`);
  } catch (error) {
    failed += 1;
    console.error(`[import-assets] failed ${entry.fileName}: ${String(error)}`);
  }
}

await writeFile(attributionPath, buildAttributionMarkdown(manifest), "utf8");
console.log(`[import-assets] wrote attribution file: ${attributionPath}`);

if (failed > 0 && !force) {
  console.error(`[import-assets] finished with ${failed} failed downloads.`);
  process.exit(1);
}

console.log(`[import-assets] complete. downloaded=${downloaded}, failed=${failed}`);
