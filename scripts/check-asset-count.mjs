// Every "N asset types" the website says must be the same number, and the
// real one.
//
// The site said "40+" for months after the app reached 62, because nobody
// updates a marketing number when a type is added. The real count lives in the
// app's seed_data.json, in the private zinfai repository. When that repository
// is checked out beside this one, the claims are checked against it. In CI it
// is not there, so the claims are checked against each other: a page left
// behind on an old number still fails the deploy.
//
// The app repository runs the same check over this site
// (backend/tests/test_asset_type_count_claims.py).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = join(ROOT, "..", "Zinfai", "backend", "app", "seed_data.json");

// "62 asset types", "40+ Asset Types", and the stat tile, where the number
// and its label sit in separate elements. Not "asset type pages".
const CLAIM = /(\d+)(\+?)\s*(?:<\/div>\s*<div[^>]*>)?\s*asset types\b(?!\s*pages)/gi;

// A claim about the whole catalogue, not a true one about part of it
// ("13 asset types" have a maturity date): a lower bound, or a number no
// subset comes near.
const wholeCatalogue = (m) => m[2] === "+" || Number(m[1]) >= 30;

function* pages(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* pages(path);
    else if (name.endsWith(".html")) yield path;
  }
}

const selfCheck = [
  ["62 asset types, 5 jurisdictions", "62"],
  ['<div class="num">40+</div><div class="lbl">Asset types</div>', "40"],
  ["all 40+ asset type pages", null],
];
for (const [text, want] of selfCheck) {
  const got = [...text.matchAll(CLAIM)][0]?.[1] ?? null;
  if (got !== want) throw new Error(`pattern self-check failed on ${JSON.stringify(text)}`);
}

const claims = [];
for (const path of pages(join(ROOT, "public"))) {
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(CLAIM)) {
      if (wholeCatalogue(m)) claims.push({ where: `${relative(ROOT, path)}:${i + 1}`, n: Number(m[1]), text: m[0] });
    }
  });
}
if (claims.length === 0) {
  console.error("found no asset-type count on the site — the pattern no longer matches it");
  process.exit(1);
}

let real = null;
if (existsSync(SEED)) real = JSON.parse(readFileSync(SEED, "utf8")).asset_types.length;

const counts = new Map();
for (const c of claims) counts.set(c.n, (counts.get(c.n) ?? 0) + 1);
const expected = real ?? [...counts].sort((a, b) => b[1] - a[1])[0][0];
const wrong = claims.filter((c) => c.n !== expected);

if (wrong.length) {
  const basis = real === null ? `most pages say ${expected}` : `the app has ${real}`;
  console.error(`asset-type count disagrees (${basis}):`);
  for (const c of wrong) console.error(`  ${c.where}: ${JSON.stringify(c.text)}`);
  process.exit(1);
}
console.log(`${claims.length} asset-type claims, all ${expected}` + (real === null ? " (app repo not beside this one; checked for agreement only)" : " (matches the app)"));
