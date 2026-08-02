#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findOversizedChunks, readBundleChunks } from "./check-bundle-size.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-budget-"));
try {
  fs.writeFileSync(path.join(directory, "small.js"), Buffer.alloc(499));
  fs.writeFileSync(path.join(directory, "large.js"), Buffer.alloc(501));
  fs.writeFileSync(path.join(directory, "ignored.css"), Buffer.alloc(999));

  assert.deepEqual(readBundleChunks(directory), [
    { file: "large.js", bytes: 501 },
    { file: "small.js", bytes: 499 },
  ]);
  assert.deepEqual(findOversizedChunks(directory, 500), [
    { file: "large.js", bytes: 501 },
  ]);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log("bundle budget logic OK");
