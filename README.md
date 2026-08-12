# zinfai-web

The public marketing site for **Zinfai** and **Zinfai Buddy** — live at
**[www.zinfai.com](https://www.zinfai.com)**.

Static HTML, hosted on Firebase Hosting, DNS at Cloudflare. No build step, no
framework, no dependencies.

> First time setting this up? Everything you need — Firebase project, custom
> domain, Cloudflare DNS, email routing, CI — is in **[SETUP.md](SETUP.md)**.

---

## Layout

```
zinfai-web/
├── firebase.json                  # Hosting config: cleanUrls, redirects, cache headers
├── .firebaserc                    # Firebase project alias (edit after creating the project)
├── .github/workflows/
│   └── firebase-deploy.yml        # Auto-deploy public/ on every push to main
├── SETUP.md                       # Full end-to-end setup instructions
└── public/                        # Everything deployed
    ├── index.html                 # Landing page
    ├── features.html              # Feature tour  (#track / #plan / #retire / #insights)
    ├── download.html              # Downloads + install instructions (#install-mac, #install-windows, #docker)
    ├── buddy.html                 # Zinfai Buddy (Android)
    ├── support.html               # FAQ + contact
    ├── privacy.html               # Privacy statement
    ├── 404.html                   # Not-found page
    ├── robots.txt
    ├── sitemap.xml
    ├── css/styles.css             # The entire design system
    ├── js/site.js                 # <site-nav>, <site-footer>, screenshots, download hydration
    └── images/
        ├── zinfai-logo.png        # Brand assets
        ├── zinfai-lockup.png
        ├── zinfai-logo-small.png
        ├── favicon.png
        ├── zinfai/                # Desktop screenshots  (see its README.txt)
        └── buddy/                 # Phone screenshots    (see its README.txt)
```

`cleanUrls: true` means `download.html` is served at `/download` — always link
without the `.html`.

---

## Working on it locally

Any static server will do:

```bash
cd zinfai-web/public
python3 -m http.server 5050
# → http://localhost:5050
```

That serves files at their real paths (`/download.html`). To preview exactly
what production does — clean URLs, redirects, the 404 page — use the emulator:

```bash
cd zinfai-web
firebase emulators:start --only hosting
# → http://localhost:5050/download
```

> Port **5050**, not the usual 5000: on macOS, `ControlCenter` (the AirPlay
> Receiver) already listens on 5000, so binding there fails with
> `Address already in use`. `firebase.json` pins the emulator to 5050 to match.

---

## Shared chrome

Pages don't duplicate the header and footer. Drop in the custom elements
defined in `public/js/site.js`:

```html
<site-nav active="download"></site-nav>   <!-- features | download | buddy | support -->
...
<site-footer></site-footer>
```

`site.js` is loaded synchronously from `<head>` so the elements are defined
before the parser reaches them — no flash of unstyled header. Change the nav or
footer once in `site.js` and every page follows.

---

## Screenshots

Every screenshot slot renders a styled placeholder until the real image exists,
then swaps itself out on load. So the site looks finished with no images at all,
and finishes itself as you add them — no HTML edits.

Drop files into `public/images/zinfai/` and `public/images/buddy/` using the
exact filenames listed in the `README.txt` inside each folder.

---

## Download links stay current on their own

Installers are **not** hosted here (Firebase's free tier won't serve `.exe` /
`.pkg` / `.apk`). They're GitHub Release assets on the public
[`ZinfaiAdmin/zinfai-download`](https://github.com/ZinfaiAdmin/zinfai-download)
repo.

Each release also writes `manifest/<product>.json` there. On page load `site.js`
fetches those manifests and rewrites anything tagged:

```html
<a data-download="zinfai:macos" href="…fallback URL…">Download for macOS</a>
<span data-download-version="zinfai">v1.0.2</span>
<span data-download-file="zinfai:macos">Zinfai-v1.0.2.pkg</span>
```

So a new release updates the site without a commit here. The hard-coded values
in the markup are the fallback if the manifest can't be fetched — they should be
bumped occasionally, but nothing breaks if they lag.

Product keys: `zinfai`, `zinfai-buddy`. Platform keys: `macos`, `windows`,
`android`.

---

## Deploying

Push to `main` and GitHub Actions deploys. Or, manually:

```bash
firebase deploy --only hosting
```

---

## Conventions

- Two-space indent in HTML/CSS/JS, 4-space inside `<style>`/`<script>` blocks —
  match whatever the file already does.
- No external JS. Fonts come from Google Fonts; everything else is local.
- No analytics, no cookies, no trackers. The privacy page says so — keep it true.
- Don't link to `ZinfaiAdmin/zinfai` or `ZinfaiAdmin/zinfai-buddy`: both are
  private and the links would 404 for visitors. Only `zinfai-download` (public)
  and Docker Hub `zinfaiadmin/zinfai` (public) are safe to reference.
