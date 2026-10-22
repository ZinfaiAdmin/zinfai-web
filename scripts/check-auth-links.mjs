// Every way into the account page must open it in the mode its words promise.
//
// The site had one account page, /register, and every link went there —
// "Sign in" included. The page opened in sign-up mode whatever the link said,
// so a returning user who clicked Sign in was asked for their name. Sign-in now
// has its own address, /signin (a hosting rewrite onto register.html, which
// picks its mode from the path), and this check fails the deploy if a link
// labelled one thing points at the other.
//
// It also pins the two things /signin depends on: the rewrite itself, and
// every page loading the same auth.js URL — two different `?v=` values load
// the module twice, and the second initializeApp() throws.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(html|js)$/.test(name)) yield path;
  }
}

const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const SIGN_IN = /^(sign in|log in|login)\b/;
const SIGN_UP = /\b(create (a |an |your )?(free )?account|register|sign up)\b/;

const problems = [];
const authVersions = new Map();

for (const path of files(PUBLIC)) {
  const src = readFileSync(path, "utf8");
  const where = relative(ROOT, path);

  for (const m of src.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].split(/[?#]/)[0];
    const words = text(m[2]);
    if (SIGN_IN.test(words) && href !== "/signin")
      problems.push(`${where}: "${words}" links to ${m[1]}, not /signin`);
    if (SIGN_UP.test(words) && href !== "/register")
      problems.push(`${where}: "${words}" links to ${m[1]}, not /register`);
    if (href === "/register" && !SIGN_UP.test(words))
      problems.push(`${where}: "${words}" opens the sign-up form; link to /signin unless it is a sign-up link`);
  }

  // auth.js's own header comment quotes a <script> tag as an example.
  if (where.endsWith("auth.js")) continue;
  for (const m of src.matchAll(/["']\/js\/auth\.js(\?v=\d+)?["']/g)) {
    const v = m[1] || "(none)";
    authVersions.set(v, [...(authVersions.get(v) || []), where]);
  }
}

if (authVersions.size > 1)
  problems.push("pages load different auth.js URLs, so it would initialise twice: " +
    [...authVersions].map(([v, w]) => `${v} in ${[...new Set(w)].join(", ")}`).join("; "));

const hosting = JSON.parse(readFileSync(join(ROOT, "firebase.json"), "utf8")).hosting;
if (!(hosting.rewrites || []).some((r) => r.source === "/signin" && r.destination === "/register.html"))
  problems.push('firebase.json: no rewrite from /signin to /register.html, so every "Sign in" link 404s');

// The sign-in form hides the name field with `hidden`; without this rule a
// class that sets display overrides it, and the field shows anyway.
if (!/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/.test(readFileSync(join(PUBLIC, "css", "styles.css"), "utf8")))
  problems.push("public/css/styles.css: no `[hidden]{display:none !important}`, so `hidden` loses to any class that sets display");

if (problems.length) {
  console.error("Account links disagree with what they say:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("Account links: every sign-in link opens /signin, every sign-up link /register.");
