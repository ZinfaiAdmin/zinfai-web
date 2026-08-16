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

   Deliberately NOT exposed: the release asset URLs themselves. The manifest
   route strips them, because it is readable by anyone.
   ===================================================================== */

import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/* Fine-grained PAT with Contents: read-only on ZinfaiAdmin/zinfai-download.
   Set with:  firebase functions:secrets:set GITHUB_TOKEN                  */
const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");

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

    const tag = `${product}-v${manifest.version}`;
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
    { region: "us-central1", secrets: [GITHUB_TOKEN], cors: false, maxInstances: 10 },
    async (req, res) => {
        const path = route(req);
        const token = GITHUB_TOKEN.value();

        try {
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
