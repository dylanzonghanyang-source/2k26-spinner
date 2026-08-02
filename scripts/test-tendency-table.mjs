#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "src", "data", "tendencyProfiles.min.json");
const table = JSON.parse(fs.readFileSync(file, "utf8"));

assert(Array.isArray(table.slugs), "slugs must be an array");
assert(Array.isArray(table.fields), "fields must be an array");
assert(Array.isArray(table.rows), "rows must be an array");
assert.equal(table.slugs.length, table.rows.length, "every slug must have one row");
assert.equal(new Set(table.slugs).size, table.slugs.length, "slugs must be unique");
assert.equal(new Set(table.fields).size, table.fields.length, "fields must be unique");
assert(table.fields.length >= 90, "expected the full ATD tendency field set");
assert(
  table.rows.every((row) => Array.isArray(row) && row.length === table.fields.length),
  "every row must align with the fields array",
);
assert(
  table.rows.flat().every((value) => value === null || (Number.isInteger(value) && value >= 0 && value <= 100)),
  "tendency cells must be null or integers from 0 to 100",
);

const rawBytes = fs.statSync(file).size;
assert(rawBytes < 160_000, `compact tendency table must stay below 160KB; got ${rawBytes} bytes`);

console.log(`tendency table OK: ${table.slugs.length} players × ${table.fields.length} fields, ${rawBytes} bytes`);
