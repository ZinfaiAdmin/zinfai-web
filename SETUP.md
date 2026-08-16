# Setting up www.zinfai.com — end to end

Everything needed to take this repo from a folder on your laptop to a live site
at **https://www.zinfai.com**, with automatic deploys and gated downloads.

> **If you are the maintainer, not a first-time reader:** §§1–8 are already done
> and are kept here as reference for rebuilding. The only outstanding work is
> [§9 Gated downloads & accounts](#9-gated-downloads--accounts), which opens with
> a checked list of what is and isn't done. Day to day you only need
> [§10 Publishing a new release](#10-publishing-a-new-release) and
> [§11 Adding screenshots](#11-adding-screenshots).

| # | Step | Where | Roughly | Status |
|---|------|-------|---------|--------|
| 1 | [Prerequisites](#1-prerequisites) | your machine | 10 min | ✅ |
| 2 | [Preview the site locally](#2-preview-the-site-locally) | your machine | 2 min | ✅ |
| 3 | [Create the Firebase project](#3-create-the-firebase-project) | Firebase console | 5 min | ✅ |
| 4 | [Connect the CLI and deploy](#4-connect-the-cli-and-deploy) | terminal | 5 min | ✅ |
| 5 | [Add the custom domain](#5-add-the-custom-domain-in-firebase) | Firebase console | 5 min | ✅ |
| 6 | [Point Cloudflare DNS at it](#6-point-cloudflare-dns-at-firebase) | Cloudflare | 10 min + wait | ✅ apex + www |
| 7 | [Turn on support@zinfai.com](#7-email-routing-for-supportzinfaicom) | Cloudflare | 10 min | ✅ routing on |
| 8 | [Continuous deployment](#8-continuous-deployment-from-github) | GitHub | 10 min | ✅ hosting only |
| 9 | [Gated downloads & accounts](#9-gated-downloads--accounts) | Firebase + GitHub | 45 min | ⬅ **you are here** |
| 10 | [Publishing a new release](#10-publishing-a-new-release) | CI | ongoing | — |
| 11 | [Adding screenshots](#11-adding-screenshots) | your machine | ongoing | — |
| 12 | [Launch checklist](#12-launch-checklist) | — | 10 min | — |
| 13 | [Troubleshooting](#13-troubleshooting) | — | as needed | — |

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

Every screenshot will show a styled placeholder. That's by design — see §11.

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
> GitHub Release assets — see §10.

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

### 6b. The address records

**`www` and the apex are two separate custom domains in Firebase.** Adding one
does not add the other, and each gets its own certificate. Add *both* in the
Firebase console (Hosting → Add custom domain) before touching DNS — for
`zinfai.com`, choose **"Redirect to an existing domain" → `www.zinfai.com`**, so
there is one canonical host and the `<link rel="canonical">` tags stay accurate.

Firebase then tells you which record to add per host. Modern projects get a
single IPv4 (`199.36.158.100`); older ones get two. Add exactly what the console
shows:

| Type | Name | Content | Proxy status | TTL |
|------|------|---------|--------------|-----|
| CNAME | `www` | `zinfai-web.web.app` | **DNS only (grey cloud)** | Auto |
| A | `@` | IP(s) from Firebase | **DNS only (grey cloud)** | Auto |

On Cloudflare you may instead use `CNAME @ → zinfai-web.web.app`; apex CNAME
flattening is automatic on every plan, resolves to the same address, and
survives Firebase renumbering. Firebase's verification accepts it either way.

> **A TXT record alone does nothing for resolution.** `hosting-site=…` proves
> ownership; it does not give the host an address. If `dig +short zinfai.com`
> prints nothing, there is no A/CNAME at the apex — that is the whole bug.
>
> Check the certificate before blaming DNS. This says the domain was never
> finished in the Firebase console:
>
> ```bash
> curl -sv --resolve zinfai.com:443:199.36.158.100 https://zinfai.com -o /dev/null 2>&1 \
>   | grep -iE "subject:|subjectAltName"
> # bad:  subject: CN=firebaseapp.com  /  subjectAltName does not match
> # good: a Google Trust Services cert that includes your host in its SANs
> ```

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
slow part — usually under an hour, occasionally up to 24.

Once both hosts resolve, add them to **Authentication → Settings → Authorized
domains** (`zinfai.com` and `www.zinfai.com`) or Google sign-in fails with
`auth/unauthorized-domain`. See [§9.4](#94-turn-on-the-sign-in-methods).

---

## 7. Email routing for support@zinfai.com

The site invites people to email `support@zinfai.com` on the support, privacy and
footer of every page. **That address doesn't exist until you create it** — set
this up before you tell anyone about the site.

Cloudflare Email Routing forwards it to a real inbox, free.

1. Cloudflare dashboard → `zinfai.com` → **Email Service → Email Routing** →
   **Get started**.
2. Cloudflare offers to add the required **MX** and **SPF TXT** records
   automatically. Accept — this is the correct choice unless you already run mail
   on this domain. Cloudflare then shows **DNS records: Locked**, meaning it owns
   those records from here on. That matters in
   [§9.5](#95-send-verification-email-through-resend) — read the warning there before you set
   up Resend.
3. **Destination Addresses** tab → add the real inbox (e.g.
   `zinfai.admin@gmail.com`) and click the confirmation link Cloudflare emails
   you. It stays unusable until you confirm.
4. **Routing rules** tab → **Create address**:

   | Custom address | Action | Destination |
   |----------------|--------|-------------|
   | `support@zinfai.com` | Send to an email | your confirmed inbox |

   > Cloudflare used to call this section **Custom addresses**; it is now
   > **Routing rules**. Same thing. The Overview tab's "Routing rules: 0" counter
   > is how you tell this step hasn't been done yet.

5. On the same tab, optionally enable the **catch-all** → same inbox, so typos
   like `suport@zinfai.com` still reach you.
6. **Test it.** Send a mail to `support@zinfai.com` from an unrelated account and
   confirm it lands.

**To reply as `support@zinfai.com`** (rather than from your personal Gmail), you
need an outbound SMTP server, because Cloudflare Email Routing only receives. The
tidiest option is to reuse the Resend credentials from
[§9.5](#95-send-verification-email-through-resend): in Gmail, Settings → Accounts →
*Send mail as* → **Add another email address** → `support@zinfai.com`, then give
it `smtp.resend.com`, port 587, username `resend`, password = your Resend API key.

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

## 9. Gated downloads & accounts

Installers are only served to people who have registered and verified an email
address. Nothing on the public web links to a binary any more.

**How it fits together**

```
visitor clicks Download
        ▼
 signed in & verified?  ── no ──►  /register  (Firebase Auth: Google or email+password)
        │ yes                            │
        ▼                                └─► verification email via Resend
 POST /api/download  (Firebase ID token in the Authorization header)
        ▼
 functions/index.js   verifies the token, checks email_verified,
                      logs to Firestore, asks GitHub for a signed URL
        ▼
 302 to release-assets.githubusercontent.com  (expires in minutes)
```

The check that matters is `email_verified` on the **decoded ID token**, in
`functions/index.js`. Everything in the browser is presentation — bypass it and
you get a 401 or 403.

### Where this actually stands

Sections 1–8 are done — the project, the domain, the CI. This section is the only
outstanding work, and not all of it is outstanding. Checked **15 August 2026**;
re-run the commands rather than trusting the ticks.

| | State | Check it yourself |
|---|---|---|
| Firebase project + CLI auth | ✅ done | `firebase login:list` |
| `www.zinfai.com` — DNS + cert | ✅ done | `curl -sI https://www.zinfai.com/` |
| `zinfai.com` apex — DNS + cert | ✅ done | `curl -sI https://zinfai.com/` |
| Auth authorized domains | ✅ both hosts present | see §9.4 |
| Cloudflare Email Routing (inbound) | ✅ MX + SPF live | `dig +short zinfai.com MX` |
| Blaze plan | ❌ **still Spark** | §9.1 — blocks everything below |
| Email/Password + Google sign-in | ❌ not enabled | §9.4 |
| `GITHUB_TOKEN` secret | ❌ not set (needs Blaze) | §9.3 |
| Resend — DKIM/SPF/DMARC | ❌ no records in the zone | §9.5 |
| Function + Firestore deployed | ❌ never deployed | §9.6 |
| `zinfai-download` visibility | ⚠️ **still public** | §9.2 — do this last |

**Blaze first.** Secret Manager, Cloud Functions and the Firestore API are all
gated behind it, so §9.3 and §9.6 will simply refuse to run until §9.1 is done.
Everything else can be done in any order.

> Until §9.6 deploys the function, `/api/**` 404s — so the download buttons on
> the live site currently fall back to their "Sign in to download" state and go
> nowhere useful. The site is safe, not finished.

### 9.1 Upgrade the Firebase project to Blaze

Cloud Functions cannot be deployed on the free Spark plan at all, so this is not
optional. Blaze keeps the same free tiers; at this traffic the bill is
approximately nothing, but there is **no hard spending cap**.

1. https://console.firebase.google.com/project/zinfai-web/usage/details → **Modify plan** → Blaze.
2. Set a budget alert: Google Cloud console → Billing → Budgets & alerts → e.g. $5/month.
   Alerts notify, they do not stop spend.

### 9.2 Make the downloads hub private

**Do this last**, once everything else works — it is the switch that breaks every
existing public download link.

```bash
gh repo edit ZinfaiAdmin/zinfai-download --visibility private --accept-visibility-change-consequences
```

> Already-published URLs stay published: anything already shared or cached keeps
> working from people's history until the release assets themselves move. Cut a
> fresh release after going private if that matters to you.

### 9.3 Create the GitHub token the function uses

A fine-grained PAT, scoped to just the hub repo, read-only:

- https://github.com/settings/personal-access-tokens/new
- **Token name:** anything, e.g. `zinfai-web-fn-download-reader` — see the note below
- Resource owner: **ZinfaiAdmin** · Repository access: **Only** `zinfai-download`
- Permissions → Repository → **Contents: Read-only**
- Expiry: 1 year — put a reminder in your calendar, downloads break silently when it lapses

Store it as a secret (never in the repo):

```bash
firebase functions:secrets:set GITHUB_TOKEN --project zinfai-web
# paste the token VALUE (github_pat_…) when prompted
```

> **Two different names, don't conflate them.**
>
> | | What it is | Must match? |
> |---|---|---|
> | GitHub's **Token name** | A label shown only in your own list at github.com/settings/tokens. Never transmitted. | No — pick anything readable |
> | **`GITHUB_TOKEN`** | The Secret Manager key, hardcoded as `defineSecret("GITHUB_TOKEN")` in `functions/index.js` | Yes — between that line and `secrets:set` |
>
> The secret's *value* is the `github_pat_…` string. The label you typed into
> GitHub has no bearing on it. Avoid literally naming the PAT `GITHUB_TOKEN`:
> GitHub Actions auto-injects a built-in secret of that name, so it reads as a
> collision even though the two never meet.

### 9.4 Turn on the sign-in methods

Authentication is already initialised on the project — there are just no sign-in
providers turned on, so `/register` cannot create anyone yet.

Firebase console → **Authentication** → Sign-in method:

- **Email/Password** → Enable (leave passwordless off)
- **Google** → Enable, set the support email

**Authorized domains needs nothing.** Firebase added both hosts when the custom
domains were set up in §5. Confirm without leaving the terminal:

```bash
curl -s "https://identitytoolkit.googleapis.com/v1/projects?key=$(
  grep -oE 'apiKey: *"[^"]+"' public/js/auth.js | head -1 | cut -d'"' -f2
)" | grep -o '"authorizedDomains":\[[^]]*\]'
```

That currently returns `localhost`, `zinfai-web.firebaseapp.com`,
`zinfai-web.web.app`, `zinfai.com`, `www.zinfai.com` — which is everything the
site needs. The same command is the fastest way to confirm Email/Password went
live: `"allowPasswordSignup": true` appears in the response once it is enabled.

### 9.5 Send verification email through Resend

Firebase's default sender is `noreply@zinfai-web.firebaseapp.com`, which is
Firebase-branded and spam-foldered often enough to cost you registrations.

1. Sign up at https://resend.com (free tier: 3,000 emails/month).
2. **Domains → Add domain →** `zinfai.com`. Resend gives you a DKIM TXT record,
   plus an MX and SPF pair scoped to a `send.` subdomain.
3. Add those records in **Cloudflare DNS** (DNS-only, not proxied).

   > ### ⚠️ Do not touch the apex MX or SPF records
   >
   > Email Routing (§7) already owns these at `zinfai.com`, and Cloudflare shows
   > them as **Locked**:
   >
   > ```
   > zinfai.com  MX   route1/2/3.mx.cloudflare.net
   > zinfai.com  TXT  "v=spf1 include:_spf.mx.cloudflare.net ~all"
   > ```
   >
   > **A hostname may have only one SPF record.** Two `v=spf1` TXT records on the
   > same name is a `PermError` under RFC 7208 — it doesn't merge, it fails
   > *both*, and your inbound routing breaks along with your outbound mail.
   >
   > This works out fine, because Resend puts its MX and SPF on
   > **`send.zinfai.com`**, not the apex — a different hostname, so nothing
   > collides. Its DKIM record sits at `resend._domainkey.zinfai.com`, which also
   > doesn't clash. You end up with:
   >
   > | Name | Type | Owner |
   > |------|------|-------|
   > | `zinfai.com` | MX + SPF TXT | Cloudflare Email Routing — inbound, leave alone |
   > | `cf2024-1._domainkey.zinfai.com` | TXT | Cloudflare — DKIM, already there, leave alone |
   > | `send.zinfai.com` | MX + SPF TXT | Resend — outbound |
   > | `resend._domainkey.zinfai.com` | TXT | Resend — DKIM |
   >
   > **The two DKIM records do not conflict**, even though both sign for
   > `zinfai.com`. DKIM is selector-scoped: a receiver reads the `s=` tag on the
   > message and looks up only that selector. `cf2024-1` and `resend` are
   > different names, so both coexist. This is the intended design for multiple
   > senders — and it is precisely what SPF lacks, which is why SPF is the one
   > record type to be careful with here.
   >
   > If any guide tells you to add `include:amazonses.com` to the apex SPF record,
   > it is assuming you don't have Email Routing. You do. Don't.

3b. **Add a DMARC record** — the zone has none, and mail from a domain with DKIM
   and SPF but no DMARC policy still gets treated with suspicion by Gmail and
   Outlook. Start in monitor-only mode:

   | Type | Name | Content |
   |------|------|---------|
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:support@zinfai.com` |

   `p=none` changes nothing about delivery; it just asks receivers to report. Once
   you've watched the reports for a few weeks and confirmed only Resend and
   Cloudflare send as you, tighten to `p=quarantine`.
4. Wait for Resend to show the domain as **Verified**.
5. **API Keys → Create**, then in Resend take the **SMTP** credentials
   (`smtp.resend.com`, port 587, username `resend`, password = the API key).
6. Firebase console → Authentication → **Templates** → Email address verification
   → the pencil icon → **SMTP settings**, and fill in those credentials with
   sender `Zinfai <verify@zinfai.com>`.
7. Edit the template wording so it reads as Zinfai, not Firebase.

Send yourself a test registration and confirm the mail lands in the inbox rather
than spam.

### 9.6 Deploy

```bash
cd functions && npm install && cd ..
firebase deploy --only functions,firestore:rules,firestore:indexes,hosting --project zinfai-web
```

The first functions deploy also enables Cloud Build, Artifact Registry and Cloud
Run on the project; accept the prompts.

> **The GitHub Actions workflow does not cover this.**
> `.github/workflows/firebase-deploy.yml` uses `action-hosting-deploy`, which
> deploys **hosting only**. Pushing to `main` will publish the pages but leave
> the function and the Firestore rules at whatever version you last pushed by
> hand. Until the workflow is extended, run the `firebase deploy` above yourself
> whenever `functions/` or `firestore.rules` changes.
>
> Extending it means granting the deploy service account more than Hosting
> Admin — at minimum Cloud Functions Admin, Service Account User, Cloud Build
> Editor, Artifact Registry Admin and Cloud Datastore Owner.

### 9.7 Seeing who registered

Both collections are written only by the function, and are not client-readable.

- **Firebase console → Firestore → `users`** — one doc per registration: email,
  name, provider, `emailVerified`, `createdAt`, `downloadCount`, `lastDownloadAt`.
- **Firestore → `downloads`** — one doc per download: uid, email, product,
  platform, version, timestamp, IP, user agent.

Export the lot to CSV when you want it:

```bash
gcloud firestore export gs://zinfai-web.firebasestorage.app/exports/$(date +%F) \
  --collection-ids=users,downloads --project zinfai-web
```

### 9.8 Local development

```bash
firebase emulators:start --only hosting,functions,firestore,auth --project zinfai-web
```

`auth.js` points at production Firebase Auth, so signing in against the emulator
needs `connectAuthEmulator` wiring that is deliberately not there. For most UI
work, run the emulator and sign in against the real project instead.

---

## 10. Publishing a new release

**The website does not need a commit when you ship a new version.** It reads the
current version from `/api/manifest` at page load.

### How the chain works

```
ZinfaiAdmin/zinfai  (private)             ZinfaiAdmin/zinfai-buddy  (private)
        │ release v1.0.3                          │ release v1.0.1
        ▼                                         ▼
   installer CI builds .pkg / .exe           CI builds signed .apk
        │                                         │
        └──────────────┬──────────────────────────┘
                       ▼
        ZinfaiAdmin/zinfai-download   (PRIVATE — the hub)
          releases/zinfai-v1.0.3/Zinfai-v1.0.3.pkg
          releases/zinfai-buddy-v1.0.1/Zinfai-Buddy-v1.0.1.apk
          manifest/zinfai.json
          manifest/zinfai-buddy.json
                       ▼
        functions/index.js  — reads the manifest with GITHUB_TOKEN, checks the
                              caller has a verified account, and returns a
                              short-lived signed GitHub URL
                       ▼
        www.zinfai.com  — js/site.js fills in version badges and file names;
                          the buttons never hold a URL
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

The hub repo must exist and be **private** — see
[§9](#9-gated-downloads--accounts). If it is still public, the gate is
decorative, because the release asset URLs remain fetchable by anyone.

```bash
gh repo view ZinfaiAdmin/zinfai-download --json visibility
gh repo edit ZinfaiAdmin/zinfai-download --visibility private --accept-visibility-change-consequences
```

The publishing CI needs a `DOWNLOADS_TOKEN` secret — a PAT with
`contents: write` on `ZinfaiAdmin/zinfai-download` — set on **both** the `zinfai`
and `zinfai-buddy` repos.

### What the site expects in markup

Download triggers are `<button>`, never `<a href>` — there is no public URL to
put in an href, and that is the point.

```html
<button type="button" class="btn" data-download="zinfai:macos" data-dl-ready="Download for Mac">
  <span data-dl-label>Download for Mac</span>
</button>

<span data-download-version="zinfai">v1.0.6</span>                 <!-- version badge -->
<span data-download-file="zinfai:macos">Zinfai-v1.0.6.pkg</span>   <!-- inside the install command -->
```

`site.js` swaps the label to "Sign in to download" for signed-out visitors and
sends them to `/register`. Elements marked `data-dl-hint` are hidden once the
visitor is verified.

If the manifest can't be fetched the hard-coded text stays as-is, so the page
never renders blank — it just goes stale. Bump it whenever you happen to edit
the page.

> **Known gap on day one:** `manifest/zinfai-buddy.json` does not exist yet
> because no Zinfai Buddy release has been published to the hub. Until the Buddy
> release workflow runs, the hard-coded fallback link
> (`zinfai-buddy-v1.0.0/Zinfai-Buddy-v1.0.0.apk`) will 404. Either run the Buddy
> release, or temporarily point that button at `/support` before you publicise
> the site.

### Sanity-check after a release

```bash
# public endpoint — version and file names only, never a URL
curl -s "https://www.zinfai.com/api/manifest?product=zinfai" | jq .

# the gate should refuse an anonymous caller
curl -s -X POST https://www.zinfai.com/api/download \
  -H 'Content-Type: application/json' \
  -d '{"product":"zinfai","platform":"macos"}' | jq .
# expect: {"error":"Sign in to continue."}
```

Then load https://www.zinfai.com/download, confirm the version badges show the
new number, sign in, and check the button actually delivers the file.

---

## 11. Adding screenshots

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

## 12. Launch checklist

Run through this once the domain is connected.

- [ ] `https://www.zinfai.com` loads with a valid certificate
- [ ] `https://zinfai.com` 301-redirects to `www`
- [ ] `http://www.zinfai.com` redirects to `https`
- [ ] Every nav and footer link resolves: `/`, `/features`, `/download`, `/buddy`, `/support`, `/privacy`
- [ ] The redirects work: `/downloads` → `/download`, `/zinfai-buddy` → `/buddy`, `/help` → `/support`
- [ ] A nonsense URL like `/nope` renders the branded 404
- [ ] Anchor links land correctly: `/features#track`, `/download#requirements`, `/buddy#install`
- [ ] Version badges show the current version, not the hard-coded fallback
- [ ] The copy-to-clipboard button on the Mac install command works
- [ ] `support@zinfai.com` receives a test email

The gate (after §9 is deployed — all of these fail today):

- [ ] `/api/manifest?product=zinfai` returns JSON with a version and **no URL**
- [ ] Signed out, a download button reads "Sign in to download" and goes to `/register`
- [ ] Registering with email sends a verification mail **from `zinfai.com`, to the inbox not spam**
- [ ] Before verifying, the button still refuses; `POST /api/download` returns 403 `email-not-verified`
- [ ] After clicking the link and pressing "I've verified — continue", the download starts
- [ ] Google sign-in works on `www.zinfai.com` and lands verified immediately
- [ ] The same flow works on the apex `zinfai.com`
- [ ] `curl -X POST https://www.zinfai.com/api/download` with no token returns 401
- [ ] Firestore has one `users` doc and one `downloads` doc for that test
- [ ] Every installer still downloads **after** `zinfai-download` goes private
- [ ] The site is usable at 375 px wide (iPhone SE) — check the nav, tables and phone frames
- [ ] `https://www.zinfai.com/robots.txt` and `/sitemap.xml` both load
- [ ] Submit the sitemap: [Google Search Console](https://search.google.com/search-console) → add `https://www.zinfai.com` (verify via the DNS TXT method, which Cloudflare makes trivial) → **Sitemaps** → submit `sitemap.xml`
- [ ] Paste the URL into a link preview tester and confirm the OG image renders
- [ ] Lighthouse: aim for 95+ on Performance, Accessibility, Best Practices, SEO

---

## 13. Troubleshooting

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
| `/api/**` serves the 404 page, but the function works at `https://us-central1-zinfai-web.cloudfunctions.net/api` | On the **first** deploy, hosting is released before the function exists, so the rewrite has nothing to bind to | `firebase deploy --only hosting` again. Only ever bites the first time; not a config error, so don't go editing the rewrite |
| Buddy release never publishes, `Release` run finishes in ~10s | `release.yml` gates on `expo.version` changing in `app.json`; a plain push doesn't qualify | Bump `expo.version` (and `android.versionCode`), or force it: `gh workflow run release.yml -R ZinfaiAdmin/zinfai-buddy --ref main` |
| `firebase deploy` says credentials invalid | Expired CLI login | `firebase login --reauth` |
| Download button 404s | No hub release for that version yet, or the fallback URL is stale | Check `manifest/<product>.json` on the hub; re-run the release workflow |
| Version badge shows an old number | Manifest fetch failed, so the fallback text is showing | Open DevTools → Network, look for the `manifest/*.json` request |
| Screenshots still show placeholders | Filename mismatch or the file isn't deployed | Compare against the folder's `README.txt`; confirm the file is committed |
| Email to `support@zinfai.com` bounces | Email Routing not enabled, or the destination isn't confirmed | §7 — check the destination shows **Verified** |

---

## Reference

| Thing | Where |
|---|---|
| Site source | `ZinfaiAdmin/zinfai-web` (this repo, public) |
| Downloads hub | `ZinfaiAdmin/zinfai-download` — going private in §9.2 |
| Docker image | https://hub.docker.com/r/zinfaiadmin/zinfai (stays public) |
| Firebase console | https://console.firebase.google.com/project/zinfai-web |
| Cloudflare dashboard | https://dash.cloudflare.com |
| Resend dashboard | https://resend.com/domains |
| Support inbox | support@zinfai.com (Cloudflare Email Routing) |

**Never link to these from the site:** `ZinfaiAdmin/zinfai`,
`ZinfaiAdmin/zinfai-buddy`, and — once §9.2 is done — `ZinfaiAdmin/zinfai-download`.
All three 404 for visitors, and the third is the whole point of the gate.

**The Docker image stays public and pullable by name.** It has to: the installers
pull it unauthenticated. Removing the `docker run` instructions from the site
means it is no longer *advertised*, not that it is *restricted*. Anyone who knows
`zinfaiadmin/zinfai` can still pull it. The registration wall is a front door, not
a lock — that was the deliberate trade, made to keep installs working.

---

## Optional: a support ticket system

The site currently routes support through `support@zinfai.com` and the FAQ, which
is the right amount of machinery for now.

If volume ever justifies it, the sibling `dsquareapps` project has a working
pattern to copy: a Cloudflare Worker (`support-api`) backed by a D1 database,
with a ticket-submission form and a `tickets.html` board on the site. It needs a
Worker deploy, a D1 binding and API secrets — a couple of hours of work, and
worth deferring until someone actually asks for it.
