/* =====================================================================
   Gated download API for www.zinfai.com
   ---------------------------------------------------------------------
   The installers live in a PRIVATE GitHub repo (ZinfaiAdmin/zinfai-download).
   Nothing on the public web links to them directly any more. To get a file a
   caller must present a Firebase ID token for an account with a verified
   email; this function then asks GitHub for a short-lived signed asset URL
   and hands that back. GitHub serves the bytes, so we pay no egress.

   Mounted at /api/** by a Firebase Hosting rewrite, which keeps it
   same-origin with the site (no CORS) and lets us read the caller's IP from
   the x-forwarded-for header.

   Routes:
     GET  /api/manifest?product=zinfai   public   version + file names + sha256
     POST /api/profile                   auth     upsert the users/{uid} record
     POST /api/download                  auth+verified  mint a signed URL
     POST /api/report                    public   file a problem report from the app
     POST /api/parser-spec               public   open a pull request for a learned
                                                  statement Format (zinfai-parser-packs)

   Deliberately NOT exposed: the release asset URLs themselves. The manifest
   route strips them, because it is readable by anyone.
   ===================================================================== */

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { createHash, randomBytes } from "node:crypto";

/* Fine-grained PAT with Contents: read-only on ZinfaiAdmin/zinfai-download.
   Set with:  firebase functions:secrets:set GITHUB_TOKEN                  */
const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");
/* Contents + pull requests write on ZinfaiAdmin/zinfai-parser-packs and
   nothing else. Kept apart from GITHUB_TOKEN, which can read the private
   download repo: this route is public. */
const PARSER_PACKS_TOKEN = defineSecret("PARSER_PACKS_TOKEN");

initializeApp();
const db = getFirestore();

const REPO = "ZinfaiAdmin/zinfai-download";
const GH = "https://api.github.com";

/* Which platforms each product publishes. Requests for anything not listed
   here are rejected before we ever talk to GitHub. */
const PRODUCTS = {
    "zinfai": ["macos", "windows"],
    "zinfai-buddy": ["android"],
};

/* Signed GitHub asset URLs are valid for a few minutes; there is no point
   handing the same user a fresh one on every click, but there is also no
   harm. The cache here is only to stay well inside GitHub's API rate limit
   for the manifest, which every visitor to /download reads. */
const MANIFEST_TTL_MS = 5 * 60 * 1000;
const manifestCache = new Map();

function ghHeaders(token) {
    return {
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "zinfai-web-download-api",
    };
}

/* ---- manifest ----------------------------------------------------------
   The release CI writes manifest/<product>.json into the repo. We read it
   through the contents API because the repo is private, so raw.github…
   is no longer publicly fetchable. */
async function readManifest(product, token) {
    const hit = manifestCache.get(product);
    if (hit && Date.now() - hit.at < MANIFEST_TTL_MS) return hit.value;

    const res = await fetch(
        `${GH}/repos/${REPO}/contents/manifest/${product}.json`,
        { headers: { ...ghHeaders(token), Accept: "application/vnd.github.raw" } }
    );
    if (!res.ok) throw new Error(`manifest ${product}: GitHub ${res.status}`);

    const value = await res.json();
    manifestCache.set(product, { at: Date.now(), value });
    return value;
}

/* ---- signed asset URL --------------------------------------------------
   Two hops: resolve the release by tag to find the asset id, then request
   that asset as an octet-stream. GitHub answers the second call with a 302
   to a pre-signed objects.githubusercontent.com URL that expires in a few
   minutes. We hand the browser that URL and never proxy the bytes. */
async function signedAssetUrl(product, platform, manifest, token) {
    const entry = manifest.platforms && manifest.platforms[platform];
    if (!entry || !entry.file) {
        throw new Error(`no ${platform} build in the ${product} manifest`);
    }

    /* A platform can live in an older release than the manifest's version:
       when one installer misses a release (the Mac notary queue), the
       publisher carries the last good build forward. Its own URL names the
       release it is in; the manifest version only says what the newest is. */
    const fromUrl = /\/releases\/download\/([^/]+)\//.exec(entry.url || "");
    const tag = fromUrl ? decodeURIComponent(fromUrl[1]) : `${product}-v${manifest.version}`;
    const relRes = await fetch(`${GH}/repos/${REPO}/releases/tags/${tag}`, {
        headers: { ...ghHeaders(token), Accept: "application/vnd.github+json" },
    });
    if (!relRes.ok) throw new Error(`release ${tag}: GitHub ${relRes.status}`);

    const release = await relRes.json();
    const asset = (release.assets || []).find((a) => a.name === entry.file);
    if (!asset) throw new Error(`asset ${entry.file} missing from ${tag}`);

    const dlRes = await fetch(`${GH}/repos/${REPO}/releases/assets/${asset.id}`, {
        headers: { ...ghHeaders(token), Accept: "application/octet-stream" },
        redirect: "manual",
    });
    const url = dlRes.headers.get("location");
    if (!url) throw new Error(`asset ${asset.id}: expected a redirect, got ${dlRes.status}`);

    return { url, file: entry.file, sha256: entry.sha256, size: entry.size };
}

/* ---- problem reports ---------------------------------------------------
   The desktop app has no server of its own to report to, so "Report a
   problem" posts here (Zinfai's backend, server to server — no CORS). It is
   public by necessity: the app's users have no account on this site. What
   keeps it cheap and clean instead:

     * every field is clipped to a fixed size, and only known fields are kept;
     * 5 reports an hour from one network, 300 a day in all — counted in
       reportLimits/*, whose docs carry an expiresAt for a Firestore TTL policy;
     * the caller's IP is stored only as a hash, enough to spot abuse and no
       more (a report is not a download, nothing needs to be audited);
     * a filled-in honeypot field gets a convincing answer and is dropped.

   The admin console (zinfai-admin) reads and triages reports/*. */
const REPORT_PRODUCTS = ["zinfai", "zinfai-buddy"];
const REPORT_KINDS = ["bug", "idea", "question"];
const REPORTS_PER_HOUR_PER_IP = 5;
const REPORTS_PER_DAY = 300;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

class ReportRefused extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

function clip(value, max) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function clipObject(value, keys, max) {
    const out = {};
    if (value && typeof value === "object") {
        for (const k of keys) {
            const v = clip(value[k], max);
            if (v) out[k] = v;
        }
    }
    return out;
}

function reportReference() {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const tail = randomBytes(3).toString("hex").toUpperCase();
    return `R-${day}-${tail}`;
}

function cleanReport(body) {
    const b = body || {};
    const product = REPORT_PRODUCTS.includes(b.product) ? b.product : null;
    const kind = REPORT_KINDS.includes(b.kind) ? b.kind : null;
    const title = clip(b.title, 140);
    const description = clip(b.description, 5000);
    if (!product || !kind) throw new ReportRefused(400, "Unknown product or kind of report.");
    if (!title || title.length < 3) throw new ReportRefused(400, "Please add a short summary.");
    if (!description || description.length < 10) throw new ReportRefused(400, "Please describe the problem.");
    const contact = clip(b.contact, 200);
    if (contact && !EMAIL_RE.test(contact)) throw new ReportRefused(400, "That does not look like an email address.");
    return {
        product,
        kind,
        title,
        description,
        contact,
        page: clip(b.page, 200),
        app: clipObject(b.app, ["version", "environment", "server"], 120),
        client: clipObject(b.client, ["user_agent", "language", "timezone", "screen"], 300),
        installationId: clip(b.installation_id, 64),
        recentProblems: Array.isArray(b.recent_problems)
            ? b.recent_problems.filter((x) => typeof x === "string").slice(0, 25).map((x) => x.slice(0, 300))
            : [],
    };
}

async function fileReport(req) {
    const body = req.body || {};
    if (clip(body.website, 10)) return reportReference();      // honeypot: pretend, keep nothing

    const report = cleanReport(body);
    const ip = callerIp(req) || "unknown";
    const ipHash = createHash("sha256").update("zinfai-report:" + ip).digest("hex").slice(0, 32);
    const hour = Math.floor(Date.now() / 3600000);
    const day = new Date().toISOString().slice(0, 10);
    const ipRef = db.collection("reportLimits").doc(`ip_${ipHash}_${hour}`);
    const dayRef = db.collection("reportLimits").doc(`day_${day}`);
    const id = reportReference();

    await db.runTransaction(async (tx) => {
        const [perIp, perDay] = await Promise.all([tx.get(ipRef), tx.get(dayRef)]);
        if ((perIp.get("count") || 0) >= REPORTS_PER_HOUR_PER_IP) {
            throw new ReportRefused(429, "Too many reports from this network. Please try again in an hour.");
        }
        if ((perDay.get("count") || 0) >= REPORTS_PER_DAY) {
            throw new ReportRefused(429, "The report service is busy today. Please try again tomorrow.");
        }
        const expiresAt = Timestamp.fromMillis(Date.now() + 2 * 86400000);
        tx.set(ipRef, { count: FieldValue.increment(1), expiresAt }, { merge: true });
        tx.set(dayRef, { count: FieldValue.increment(1), expiresAt }, { merge: true });
        tx.create(db.collection("reports").doc(id), {
            ...report,
            status: "new",
            notes: "",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            ipHash,
            via: clip(req.get("user-agent"), 200),
        });
    });
    return id;
}

/* ---- statement Formats shared by Zinfai installs -----------------------
   Every Zinfai install posts the Formats it learned (a layout description
   plus a redacted sample it must reproduce) here, and this opens the pull
   request on the public pack repository. Nothing here can check that the
   Format reads its sample — that is the pack repository's CI, which runs
   Zinfai's own interpreter — so this only keeps out what is malformed,
   oversized, already covered or arriving too fast.

   Contract with backend/app/services/parser_pack_publisher.py:
     201 {status:"opened", url, branch, path, repo}
     409 {status:"duplicate", path}      layout already on main or in an open PR
     4xx {error}                          the entry is wrong; not retried
     429 / 5xx {error}                    try again later; costs no attempt */
const PACKS_REPO = "ZinfaiAdmin/zinfai-parser-packs";
const PACKS_BASE = "main";
const LAYOUT_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+){1,11}$/;
// Every kind the app learns: a header-read kind (scheme, CAS, holdings)
// ships its sample with the demo identity and proves it on the packs repo.
const SHAREABLE_KINDS = ["bank_savings", "bank_cc", "holdings", "tradebook",
    "ppf", "pf", "nps", "ssy", "fd", "cas"];
const MAX_SPEC_BYTES = 1_500_000;
const SPECS_PER_HOUR_PER_IP = 20;
const SPECS_PER_DAY = 300;

class SpecRefused extends Error {
    constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

function cleanContribution(body) {
    const b = body || {};
    const key = typeof b.layout_key === "string" ? b.layout_key : "";
    if (key.length > 100 || !LAYOUT_KEY_RE.test(key)) throw new SpecRefused(400, "layout_key is not a layout key.");
    if (!SHAREABLE_KINDS.includes(b.kind)) throw new SpecRefused(400, "This kind of Format is not shared.");
    const pack = b.pack;
    if (!pack || typeof pack !== "object" || pack.pack_version !== 1 || !Array.isArray(pack.specs)
        || pack.specs.length !== 1) {
        throw new SpecRefused(400, "pack must be a version 1 pack carrying exactly one Format.");
    }
    const entry = pack.specs[0];
    if (!entry || typeof entry !== "object" || !entry.spec || typeof entry.spec !== "object"
        || !entry.fixture || typeof entry.fixture !== "object" || !Array.isArray(entry.expected)
        || typeof entry.spec.id !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(entry.spec.id)) {
        throw new SpecRefused(400, "The Format entry is missing its spec, fixture or expected rows.");
    }
    if ((entry.spec.kind || "bank_savings") !== b.kind) throw new SpecRefused(400, "kind does not match the Format.");
    const text = JSON.stringify(pack, null, 2) + "\n";
    if (Buffer.byteLength(text) > MAX_SPEC_BYTES) throw new SpecRefused(413, "The Format is too large to share.");
    const bankKey = typeof b.bank_key === "string" ? b.bank_key.slice(0, 80) : null;
    return { key, kind: b.kind, bankKey, specId: entry.spec.id, rows: entry.expected.length, text };
}

async function github(token, method, path, body) {
    const res = await fetch(GH + path, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "zinfai-web-parser-spec-intake",
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && method === "GET") return null;
    if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        const err = new Error(`GitHub ${method} ${path}: ${res.status} ${detail}`);
        err.status = res.status;
        throw err;
    }
    return res.status === 204 ? {} : res.json();
}

async function rateLimitSpecs(req) {
    const ip = callerIp(req) || "unknown";
    const ipHash = createHash("sha256").update("zinfai-spec:" + ip).digest("hex").slice(0, 32);
    const hour = Math.floor(Date.now() / 3600000);
    const day = new Date().toISOString().slice(0, 10);
    const ipRef = db.collection("reportLimits").doc(`spec_ip_${ipHash}_${hour}`);
    const dayRef = db.collection("reportLimits").doc(`spec_day_${day}`);
    await db.runTransaction(async (tx) => {
        const [perIp, perDay] = await Promise.all([tx.get(ipRef), tx.get(dayRef)]);
        if ((perIp.get("count") || 0) >= SPECS_PER_HOUR_PER_IP
            || (perDay.get("count") || 0) >= SPECS_PER_DAY) {
            throw new SpecRefused(429, "Too many Formats at once. Try again later.");
        }
        const expiresAt = Timestamp.fromMillis(Date.now() + 2 * 86400000);
        tx.set(ipRef, { count: FieldValue.increment(1), expiresAt }, { merge: true });
        tx.set(dayRef, { count: FieldValue.increment(1), expiresAt }, { merge: true });
    });
}

async function openContribution(req) {
    const c = cleanContribution(req.body);
    const token = PARSER_PACKS_TOKEN.value();
    const path = `contributions/${c.key}.json`;

    /* Same two checks the app makes on its own GitHub route: on main, or
       already waiting in a pull request whose branch carries this key. */
    if (await github(token, "GET", `/repos/${PACKS_REPO}/contents/${path}?ref=${PACKS_BASE}`)) {
        throw new SpecRefused(409, "Already shared.", { status: "duplicate", path });
    }
    const open = await github(token, "GET", `/repos/${PACKS_REPO}/pulls?state=open&per_page=100`);
    if ((open || []).some((pr) => pr.head && pr.head.ref.startsWith(`parser-spec/${c.key}-`))) {
        throw new SpecRefused(409, "Already waiting for review.", { status: "duplicate", path });
    }

    await rateLimitSpecs(req);

    const head = await github(token, "GET", `/repos/${PACKS_REPO}/git/ref/heads/${PACKS_BASE}`);
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const branch = `parser-spec/${c.key}-${stamp}`;
    await github(token, "POST", `/repos/${PACKS_REPO}/git/refs`, { ref: `refs/heads/${branch}`, sha: head.object.sha });
    await github(token, "PUT", `/repos/${PACKS_REPO}/contents/${path}`, {
        message: `Add parser spec ${c.specId}`,
        content: Buffer.from(c.text).toString("base64"),
        branch,
    });
    const pull = await github(token, "POST", `/repos/${PACKS_REPO}/pulls`, {
        title: `Parser spec: ${c.bankKey || c.specId}`,
        head: branch,
        base: PACKS_BASE,
        body: [
            `Contributed parser spec \`${c.specId}\`` + (c.bankKey ? ` for \`${c.bankKey}\`.` : "."),
            "",
            `The bundled fixture is a redacted sample; the spec reproduces ${c.rows} transaction(s) from it, and that is checked again on install.`,
            "",
            "Opened by the zinfai.com contribution service on behalf of a Zinfai install.",
        ].join("\n"),
    });
    return { status: "opened", url: pull.html_url, branch, path, repo: PACKS_REPO };
}

/* ---- request helpers --------------------------------------------------- */

async function requireUser(req) {
    const header = req.get("authorization") || "";
    const match = header.match(/^Bearer (.+)$/);
    if (!match) return { error: [401, "Sign in to continue."] };
    try {
        return { user: await getAuth().verifyIdToken(match[1]) };
    } catch {
        return { error: [401, "Your session has expired. Please sign in again."] };
    }
}

function callerIp(req) {
    const fwd = req.get("x-forwarded-for") || "";
    return fwd.split(",")[0].trim() || req.ip || null;
}

/* Hosting rewrites pass the original path through, but the emulator and a
   direct function call differ on the /api prefix. Normalise both. */
function route(req) {
    return req.path.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
}

export const api = onRequest(
    { region: "us-central1", secrets: [GITHUB_TOKEN, PARSER_PACKS_TOKEN], cors: false, maxInstances: 10 },
    async (req, res) => {
        const path = route(req);

        /* ---------------- public: problem report from the app ---------------- */
        if (path === "/report" && req.method === "POST") {
            try {
                const id = await fileReport(req);
                res.set("Cache-Control", "no-store");
                return res.status(201).json({ id });
            } catch (err) {
                if (err instanceof ReportRefused) return res.status(err.status).json({ error: err.message });
                console.error(path, err);
                return res.status(502).json({ error: "The report service is temporarily unavailable. Please try again later." });
            }
        }

        /* ---------------- public: a statement Format to share ---------------- */
        if (path === "/parser-spec" && req.method === "POST") {
            res.set("Cache-Control", "no-store");
            try {
                return res.status(201).json(await openContribution(req));
            } catch (err) {
                if (err instanceof SpecRefused) {
                    return res.status(err.status).json({ error: err.message, ...err.extra });
                }
                console.error(path, err);
                return res.status(502).json({ error: "The contribution service could not reach GitHub. Try again later." });
            }
        }

        try {
            const token = GITHUB_TOKEN.value();
            /* ---------------- public: current version ---------------- */
            if (path === "/manifest" && req.method === "GET") {
                const product = String(req.query.product || "zinfai");
                if (!PRODUCTS[product]) return res.status(404).json({ error: "Unknown product." });

                const m = await readManifest(product, token);
                const platforms = {};
                for (const p of PRODUCTS[product]) {
                    const e = m.platforms && m.platforms[p];
                    if (e) platforms[p] = { file: e.file, size: e.size, sha256: e.sha256 };
                }
                /* Public response — file names and hashes only, never a URL. */
                res.set("Cache-Control", "public, max-age=300");
                return res.json({ product, version: m.version, platforms });
            }

            /* ---------------- auth: record the registration ---------------- */
            if (path === "/profile" && req.method === "POST") {
                const { user, error } = await requireUser(req);
                if (error) return res.status(error[0]).json({ error: error[1] });

                const ref = db.collection("users").doc(user.uid);
                const existing = await ref.get();

                await ref.set({
                    uid: user.uid,
                    email: user.email || null,
                    displayName: user.name || null,
                    emailVerified: user.email_verified === true,
                    providers: (user.firebase && user.firebase.identities)
                        ? Object.keys(user.firebase.identities)
                        : [],
                    signInProvider: user.firebase ? user.firebase.sign_in_provider : null,
                    lastSeenAt: FieldValue.serverTimestamp(),
                    ...(existing.exists ? {} : {
                        createdAt: FieldValue.serverTimestamp(),
                        signupIp: callerIp(req),
                        signupUserAgent: req.get("user-agent") || null,
                        downloadCount: 0,
                    }),
                }, { merge: true });

                return res.json({ ok: true, emailVerified: user.email_verified === true });
            }

            /* ---------------- auth + verified: mint a download ---------------- */
            if (path === "/download" && req.method === "POST") {
                const { user, error } = await requireUser(req);
                if (error) return res.status(error[0]).json({ error: error[1] });

                /* The whole point of the gate. Checked against the decoded
                   token, never against anything the client tells us. */
                if (user.email_verified !== true) {
                    return res.status(403).json({
                        code: "email-not-verified",
                        error: "Please verify your email address before downloading.",
                    });
                }

                const { product, platform } = req.body || {};
                if (!PRODUCTS[product] || !PRODUCTS[product].includes(platform)) {
                    return res.status(400).json({ error: "Unknown product or platform." });
                }

                const manifest = await readManifest(product, token);
                const asset = await signedAssetUrl(product, platform, manifest, token);

                await db.collection("downloads").add({
                    uid: user.uid,
                    email: user.email || null,
                    product,
                    platform,
                    version: manifest.version,
                    file: asset.file,
                    at: FieldValue.serverTimestamp(),
                    ip: callerIp(req),
                    userAgent: req.get("user-agent") || null,
                });
                await db.collection("users").doc(user.uid).set({
                    downloadCount: FieldValue.increment(1),
                    lastDownloadAt: FieldValue.serverTimestamp(),
                }, { merge: true });

                /* Short-lived and single-user; still worth telling caches to
                   keep their hands off it. */
                res.set("Cache-Control", "no-store");
                return res.json({
                    url: asset.url,
                    file: asset.file,
                    sha256: asset.sha256,
                    size: asset.size,
                    version: manifest.version,
                });
            }

            return res.status(404).json({ error: "Not found." });
        } catch (err) {
            console.error(path, err);
            return res.status(502).json({
                error: "The download service is temporarily unavailable. Please try again shortly.",
            });
        }
    }
);
