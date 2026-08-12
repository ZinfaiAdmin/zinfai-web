# Setting up www.zinfai.com — end to end

Everything needed to take this repo from a folder on your laptop to a live site
at **https://www.zinfai.com**, with automatic deploys and working download links.

Follow it top to bottom the first time. Later you'll only ever need
[§9 Publishing a new release](#9-publishing-a-new-release) and
[§10 Adding screenshots](#10-adding-screenshots).

| # | Step | Where | Roughly |
|---|------|-------|---------|
| 1 | [Prerequisites](#1-prerequisites) | your machine | 10 min |
| 2 | [Preview the site locally](#2-preview-the-site-locally) | your machine | 2 min |
| 3 | [Create the Firebase project](#3-create-the-firebase-project) | Firebase console | 5 min |
| 4 | [Connect the CLI and deploy](#4-connect-the-cli-and-deploy) | terminal | 5 min |
| 5 | [Add the custom domain](#5-add-the-custom-domain-in-firebase) | Firebase console | 5 min |
| 6 | [Point Cloudflare DNS at it](#6-point-cloudflare-dns-at-firebase) | Cloudflare | 10 min + wait |
| 7 | [Turn on support@zinfai.com](#7-email-routing-for-supportzinfaicom) | Cloudflare | 10 min |
| 8 | [Continuous deployment](#8-continuous-deployment-from-github) | GitHub | 10 min |
| 9 | [Publishing a new release](#9-publishing-a-new-release) | CI | ongoing |
| 10 | [Adding screenshots](#10-adding-screenshots) | your machine | ongoing |
| 11 | [Launch checklist](#11-launch-checklist) | — | 10 min |
| 12 | [Troubleshooting](#12-troubleshooting) | — | as needed |

---

## 1. Prerequisites

**Accounts you need**

- A Google account (for Firebase) — use the same `zinfai.admin@gmail.com` identity that owns the GitHub org, so you don't juggle logins.
- The Cloudflare account where `zinfai.com` is registered.
- The `ZinfaiAdmin` GitHub org (already exists).

**Tools**

```bash
# Firebase CLI
npm install -g firebase-tools
firebase --version      # 13.x or newer

# GitHub CLI (used for the downloads hub and secrets)
brew install gh
gh auth status
```

**Confirm the domain is where you think it is.** In the Cloudflare dashboard,
`zinfai.com` should be listed as an active zone using Cloudflare nameservers. If
it's registered at Cloudflare Registrar, this is automatic.

---

## 2. Preview the site locally

Before touching any cloud console, look at what you're deploying.

```bash
cd ~/Debasis/Personal/Projects/zinfai-web/public
python3 -m http.server 5050
```

Open http://localhost:5050. Note that with a plain static server the pages live
at `/download.html`, whereas production serves them at `/download` — internal
links use the clean form, so a few will 404 locally. That's expected; §4 shows
the emulator, which reproduces production exactly.

Every screenshot will show a styled placeholder. That's by design — see §10.

> **Why 5050 and not 5000?** On macOS, port 5000 is occupied by `ControlCenter`
> — the AirPlay Receiver — so `python3 -m http.server 5000` dies with
> `OSError: [Errno 48] Address already in use`. 5050 is out of its way. (You
> *can* free 5000 via System Settings → General → AirDrop & Handoff → turn off
> **AirPlay Receiver**, but there's no reason to.) `firebase.json` pins the
> Hosting emulator to 5050 for the same reason.

---

## 3. Create the Firebase project

1. Go to https://console.firebase.google.com and click **Create a project**.
2. Name it **`zinfai-web`**. Firebase will suggest a globally-unique project ID —
   if `zinfai-web` is taken it'll offer something like `zinfai-web-4f2a1`.
   **Write the actual project ID down**; you need it in the next step and it is
   not necessarily what you typed.
3. **Disable Google Analytics.** The site claims to have no trackers and the
   privacy page says so — keep that true.
4. Once created, in the left sidebar go to **Build → Hosting** and click
   **Get started**. Click through the CLI instructions (you've already done
   them) and **Continue to console**.

The free **Spark** plan is sufficient: 10 GB storage and 360 MB/day of transfer,
which a static site of this size will never approach.

> **Do not upload installers to Firebase Hosting.** The Spark plan's terms
> exclude serving binaries like `.exe`, `.pkg` and `.apk`. Installers live as
> GitHub Release assets — see §9.

Now record the ID in `.firebaserc`:

```json
{
  "projects": {
    "default": "zinfai-web"        ← replace with your real project ID
  }
}
```

---

## 4. Connect the CLI and deploy

```bash
cd ~/Debasis/Personal/Projects/zinfai-web

firebase login                     # opens a browser; use the Google account from §3
firebase use --add                 # pick the project, alias it "default"
```

If you get *"Authentication Error: Your credentials are no longer valid"*, run
`firebase login --reauth`.

**Preview exactly what production will serve:**

```bash
firebase emulators:start --only hosting
```

Open http://localhost:5050 and click through every page. Clean URLs
(`/download`, `/features`, `/buddy`, `/support`, `/privacy`), the redirects, and
the 404 page all behave here as they will live.

**Deploy:**

```bash
firebase deploy --only hosting
```

The CLI prints a `https://<project-id>.web.app` URL. Open it — that's the live
site, already working, just not yet on your domain.

---

## 5. Add the custom domain in Firebase

In the Firebase console → **Hosting → Add custom domain**.

**Do `www.zinfai.com` first:**

1. Enter `www.zinfai.com`.
2. Leave *"Redirect zinfai.com to www.zinfai.com"* **unchecked** — you'll add the
   apex as its own domain in a moment, which is more predictable.
3. Firebase gives you a **TXT record** for verification. Copy it.
4. Add it in Cloudflare (§6), come back, and click **Verify**.
5. After verification Firebase shows the **A records** to add. Copy those too.

**Then repeat for `zinfai.com`** (the apex). When Firebase asks, choose
**Redirect to another domain → `www.zinfai.com`**, permanent (301). That way
`zinfai.com` sends visitors to `www.zinfai.com` and you have one canonical host —
which is what every `<link rel="canonical">` and the sitemap in this repo assume.

Firebase then provisions a free SSL certificate. This usually takes 20–60
minutes and can take up to 24 hours. The domain shows **Needs setup → Pending →
Connected**.

---

## 6. Point Cloudflare DNS at Firebase

Cloudflare dashboard → select `zinfai.com` → **DNS → Records**.

### 6a. The verification TXT record

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| TXT | `@` (or as Firebase specifies) | `google-site-verification=…` (paste from Firebase) | n/a | Auto |

Save, wait a minute or two, then click **Verify** back in Firebase.

### 6b. The A records

Firebase gives two IPv4 addresses. Add both, for each host:

| Type | Name | Content | Proxy status | TTL |
|------|------|---------|--------------|-----|
| A | `www` | first IP from Firebase | **DNS only (grey cloud)** | Auto |
| A | `www` | second IP from Firebase | **DNS only (grey cloud)** | Auto |
| A | `@` | first IP from Firebase | **DNS only (grey cloud)** | Auto |
| A | `@` | second IP from Firebase | **DNS only (grey cloud)** | Auto |

> ### ⚠️ The one thing that trips everybody up
>
> **Set the proxy to "DNS only" (grey cloud) while Firebase provisions the
> certificate.** With the orange cloud on, Cloudflare intercepts the HTTP
> challenge Firebase uses to issue the cert, and the domain sits on "Pending"
> forever.
>
> Once Firebase shows **Connected** and `https://www.zinfai.com` loads with a
> valid certificate, you *may* switch the proxy back to orange for Cloudflare's
> CDN and analytics. If you do, set **SSL/TLS → Overview → Full (strict)** — the
> default "Flexible" mode will cause a redirect loop against Firebase, which
> always redirects to HTTPS.
>
> Honestly: Firebase Hosting is already a global CDN with HTTP/2 and Brotli.
> Leaving the records grey-clouded is a perfectly good permanent answer and one
> less moving part.

**Delete any conflicting records first.** If Cloudflare parked the domain there
will be existing `A`/`AAAA`/`CNAME` records on `@` and `www` — remove them, or
the new ones won't take effect.

### 6c. Verify

```bash
dig +short www.zinfai.com
dig +short zinfai.com
curl -sI https://www.zinfai.com | head -1        # expect HTTP/2 200
curl -sI https://zinfai.com     | head -1        # expect a 301 to www
```

DNS changes at Cloudflare propagate in seconds; the Firebase certificate is the
slow part.

---

## 7. Email routing for support@zinfai.com

The site invites people to email `support@zinfai.com` on the support, privacy and
footer of every page. **That address doesn't exist until you create it** — set
this up before you tell anyone about the site.

Cloudflare Email Routing forwards it to a real inbox, free.

1. Cloudflare dashboard → `zinfai.com` → **Email → Email Routing** → **Get started**.
2. Cloudflare offers to add the required **MX** and **SPF TXT** records
   automatically. Accept — this is the correct choice unless you already run mail
   on this domain.
3. Under **Destination addresses**, add the real inbox (e.g.
   `zinfai.admin@gmail.com`) and click the confirmation link Cloudflare emails you.
4. Under **Custom addresses**, create:

   | Custom address | Action | Destination |
   |----------------|--------|-------------|
   | `support@zinfai.com` | Send to an email | your confirmed inbox |

5. Optionally also add a **catch-all** → same inbox, so typos like
   `suport@zinfai.com` still reach you.
6. **Test it.** Send a mail to `support@zinfai.com` from an unrelated account and
   confirm it lands.

**To reply as `support@zinfai.com`** (rather than from your personal Gmail),
in Gmail: Settings → Accounts → *Send mail as* → **Add another email address**,
enter `support@zinfai.com`, and use Gmail's SMTP relay or an app-specific setup.
Cloudflare Email Routing is receive-only; sending needs this extra step.

---

## 8. Continuous deployment from GitHub

Once this is wired up, `git push` to `main` publishes the site.

### 8a. Create the GitHub repo

```bash
cd ~/Debasis/Personal/Projects/zinfai-web
git init
git add -A
git commit -m "Initial commit: Zinfai marketing site"
git branch -M main

gh repo create ZinfaiAdmin/zinfai-web --private --source=. --remote=origin --push
```

Private is fine — Firebase deploys from CI regardless. Make it public only if you
want the site source open.

### 8b. Create a deploy service account

The easy way, from the repo directory:

```bash
firebase init hosting:github
```

It asks for the repo (`ZinfaiAdmin/zinfai-web`), creates a service account,
stores the JSON as a secret named `FIREBASE_SERVICE_ACCOUNT_<PROJECT_ID>` — for
this project, `FIREBASE_SERVICE_ACCOUNT_ZINFAI_WEB` — and offers to write a
workflow file. **Decline the workflow file** — this repo already has a better one
at `.github/workflows/firebase-deploy.yml`. If it overwrites yours, restore it
with `git checkout .github/`.

<details>
<summary>Manual alternative, if <code>hosting:github</code> misbehaves</summary>

1. Google Cloud console → **IAM & Admin → Service Accounts** → **Create**, for
   your Firebase project.
2. Name it `github-deploy`. Grant the roles **Firebase Hosting Admin** and
   **Firebase Authentication Viewer** (the deploy action checks the latter).
3. **Keys → Add key → JSON**. Download it.
4. `gh secret set FIREBASE_SERVICE_ACCOUNT_ZINFAI_WEB --repo ZinfaiAdmin/zinfai-web < path/to/key.json`
5. Delete the downloaded JSON from your machine.
</details>

The secret name must match the one in `.github/workflows/firebase-deploy.yml`.
The project ID (`zinfai-web`) is set inline in that workflow — it isn't secret,
so it needs no repo variable.

### 8c. Test it

```bash
gh workflow run "Deploy to Firebase Hosting" --repo ZinfaiAdmin/zinfai-web
gh run watch --repo ZinfaiAdmin/zinfai-web
```

Green run → the site is live from CI. From now on, edit, commit, push.

---

## 9. Publishing a new release

**The website does not need a commit when you ship a new version.** It reads the
current version and download URLs from the public downloads hub at page load.

### How the chain works

```
ZinfaiAdmin/zinfai  (private)             ZinfaiAdmin/zinfai-buddy  (private)
        │ release v1.0.3                          │ release v1.0.1
        ▼                                         ▼
   installer CI builds .pkg / .exe           CI builds signed .apk
        │                                         │
        └──────────────┬──────────────────────────┘
                       ▼
        ZinfaiAdmin/zinfai-download   (PUBLIC — the hub)
          releases/zinfai-v1.0.3/Zinfai-v1.0.3.pkg
          releases/zinfai-buddy-v1.0.1/Zinfai-Buddy-v1.0.1.apk
          manifest/zinfai.json
          manifest/zinfai-buddy.json
                       ▼
        www.zinfai.com  — js/site.js fetches the manifests and rewrites
                          every download link, version badge and filename
```

`scripts/publish_downloads.sh` in the Zinfai repo does the mirroring and writes
the manifest. Each manifest looks like:

```json
{
  "product": "Zinfai",
  "version": "1.0.2",
  "platforms": {
    "macos":   { "file": "Zinfai-v1.0.2.pkg",       "url": "https://github.com/…", "size": 123456, "sha256": "…" },
    "windows": { "file": "Zinfai-Setup-v1.0.2.exe", "url": "https://github.com/…", "size": 123456, "sha256": "…" }
  },
  "updated_at": "2026-08-11T04:00:00Z"
}
```

### One-time hub setup

The hub repo must exist and be **public**:

```bash
gh repo view ZinfaiAdmin/zinfai-download   # if this 404s:
gh repo create ZinfaiAdmin/zinfai-download --public \
  --description "Public downloads hub for Zinfai and Zinfai Buddy"
```

The publishing CI needs a `DOWNLOADS_TOKEN` secret — a PAT with
`contents: write` on `ZinfaiAdmin/zinfai-download` — set on **both** the `zinfai`
and `zinfai-buddy` repos.

### What the site expects in markup

```html
<a data-download="zinfai:macos"        href="…fallback…">Download for macOS</a>
<a data-download="zinfai:windows"      href="…fallback…">Download for Windows</a>
<a data-download="zinfai-buddy:android" href="…fallback…">Download the APK</a>

<span data-download-version="zinfai">v1.0.2</span>          <!-- version badge -->
<span data-download-file="zinfai:macos">Zinfai-v1.0.2.pkg</span>  <!-- inside the install command -->
```

If a manifest can't be fetched, the hard-coded `href` and text stay as-is, so
downloads never break — they just go stale. Bump them whenever you happen to edit
the page.

> **Known gap on day one:** `manifest/zinfai-buddy.json` does not exist yet
> because no Zinfai Buddy release has been published to the hub. Until the Buddy
> release workflow runs, the hard-coded fallback link
> (`zinfai-buddy-v1.0.0/Zinfai-Buddy-v1.0.0.apk`) will 404. Either run the Buddy
> release, or temporarily point that button at `/support` before you publicise
> the site.

### Sanity-check after a release

```bash
curl -s https://raw.githubusercontent.com/ZinfaiAdmin/zinfai-download/main/manifest/zinfai.json | jq .
curl -sI "$(curl -s https://raw.githubusercontent.com/ZinfaiAdmin/zinfai-download/main/manifest/zinfai.json | jq -r .platforms.macos.url)" | head -1
```

Then load https://www.zinfai.com/download and confirm the version badges show the
new number.

---

## 10. Adding screenshots

The site ships with self-revealing placeholders: each slot shows a styled card
until the image exists, then the real screenshot takes over on load. **No HTML
edits are ever needed** — just drop in correctly-named files.

```
public/images/zinfai/     hero, dashboard, assets-overview, statement,
                          financial-freedom, financial-planner,
                          market-insight, asset-quality        (.png)

public/images/buddy/      hero, overview, portfolio, expenses,
                          insights, asset-detail                (.png)
```

The `README.txt` in each folder lists exact filenames, target dimensions and
optimisation guidance.

**Two rules:**

1. **Use demo data**, and redact anything real that slips through — account
   numbers, holder names, email addresses.
2. **Do not reuse the old PortAct Global screenshots.** They carry the previous
   wordmark and "New to PortAct?" copy, which would undercut the rebrand.

Capture, optimise (`pngquant --quality 65-85`, ImageOptim or squoosh.app), drop
in, commit, push. CI deploys them.

---

## 11. Launch checklist

Run through this once the domain is connected.

- [ ] `https://www.zinfai.com` loads with a valid certificate
- [ ] `https://zinfai.com` 301-redirects to `www`
- [ ] `http://www.zinfai.com` redirects to `https`
- [ ] Every nav and footer link resolves: `/`, `/features`, `/download`, `/buddy`, `/support`, `/privacy`
- [ ] The redirects work: `/downloads` → `/download`, `/zinfai-buddy` → `/buddy`, `/help` → `/support`
- [ ] A nonsense URL like `/nope` renders the branded 404
- [ ] Anchor links land correctly: `/features#track`, `/download#docker`, `/buddy#install`
- [ ] Download buttons point at real, downloadable assets (see the Buddy caveat in §9)
- [ ] Version badges show the current version, not the hard-coded fallback
- [ ] The copy-to-clipboard buttons on the install and Docker commands work
- [ ] `support@zinfai.com` receives a test email
- [ ] The site is usable at 375 px wide (iPhone SE) — check the nav, tables and phone frames
- [ ] `https://www.zinfai.com/robots.txt` and `/sitemap.xml` both load
- [ ] Submit the sitemap: [Google Search Console](https://search.google.com/search-console) → add `https://www.zinfai.com` (verify via the DNS TXT method, which Cloudflare makes trivial) → **Sitemaps** → submit `sitemap.xml`
- [ ] Paste the URL into a link preview tester and confirm the OG image renders
- [ ] Lighthouse: aim for 95+ on Performance, Accessibility, Best Practices, SEO

---

## 12. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Firebase custom domain stuck on **Pending** for hours | Cloudflare proxy (orange cloud) is intercepting the certificate challenge | Set both A records to **DNS only** (grey cloud), wait, then re-check |
| `ERR_TOO_MANY_REDIRECTS` after enabling the orange cloud | Cloudflare SSL mode is **Flexible**; Firebase forces HTTPS | SSL/TLS → Overview → **Full (strict)** |
| Domain verification never succeeds | TXT record on the wrong host, or a stale one still present | Check `dig +short TXT zinfai.com`; delete old verification TXTs |
| Old content after a deploy | Browser or Cloudflare cache | Hard reload; if orange-clouded, Cloudflare → **Caching → Purge Everything** |
| `/download` 404s but `/download.html` works | Testing against a plain static server, not Firebase | Use `firebase emulators:start --only hosting` |
| `OSError: [Errno 48] Address already in use` on port 5000 | macOS `ControlCenter` (AirPlay Receiver) owns port 5000 | Use 5050, as above — or disable AirPlay Receiver in System Settings → General → AirDrop & Handoff |
| CI deploy fails with a permission error | Service account missing a role | Add **Firebase Hosting Admin** in Google Cloud IAM |
| CI deploy fails: *"Input required and not supplied: firebaseServiceAccount"* | Secret name doesn't match the workflow | `gh secret list --repo ZinfaiAdmin/zinfai-web` — it must be `FIREBASE_SERVICE_ACCOUNT_ZINFAI_WEB` (§8b) |
| `firebase deploy` says credentials invalid | Expired CLI login | `firebase login --reauth` |
| Download button 404s | No hub release for that version yet, or the fallback URL is stale | Check `manifest/<product>.json` on the hub; re-run the release workflow |
| Version badge shows an old number | Manifest fetch failed, so the fallback text is showing | Open DevTools → Network, look for the `manifest/*.json` request |
| Screenshots still show placeholders | Filename mismatch or the file isn't deployed | Compare against the folder's `README.txt`; confirm the file is committed |
| Email to `support@zinfai.com` bounces | Email Routing not enabled, or the destination isn't confirmed | §7 — check the destination shows **Verified** |

---

## Reference

| Thing | Where |
|---|---|
| Site source | `ZinfaiAdmin/zinfai-web` (this repo) |
| Public downloads hub | https://github.com/ZinfaiAdmin/zinfai-download |
| Docker image | https://hub.docker.com/r/zinfaiadmin/zinfai |
| Firebase console | https://console.firebase.google.com |
| Cloudflare dashboard | https://dash.cloudflare.com |
| Support inbox | support@zinfai.com (Cloudflare Email Routing) |

**Private repos — never link to these from the site:** `ZinfaiAdmin/zinfai` and
`ZinfaiAdmin/zinfai-buddy`. Both are private, so any link would 404 for visitors.
Only the downloads hub and Docker Hub are public.

---

## Optional: a support ticket system

The site currently routes support through `support@zinfai.com` and the FAQ, which
is the right amount of machinery for now.

If volume ever justifies it, the sibling `dsquareapps` project has a working
pattern to copy: a Cloudflare Worker (`support-api`) backed by a D1 database,
with a ticket-submission form and a `tickets.html` board on the site. It needs a
Worker deploy, a D1 binding and API secrets — a couple of hours of work, and
worth deferring until someone actually asks for it.
