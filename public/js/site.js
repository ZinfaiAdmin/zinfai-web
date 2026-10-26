/* =====================================================================
   Shared site chrome & helpers — single source of truth for every page.
   ---------------------------------------------------------------------
   Pages drop in <site-nav> and <site-footer> instead of copy-pasting the
   markup. Loaded synchronously from <head> so the custom elements are
   defined before the parser reaches them — the header renders in place
   with no flash.

   Usage:
     <site-nav active="download"></site-nav>   <!-- features | videos | download | buddy | support -->
     <site-footer></site-footer>
   ===================================================================== */
(function () {
    "use strict";

    const NAV_HTML = `
<nav>
<div class="container nav-inner">
    <a class="brand" href="/">
        <img src="/images/zinfai-logo.png" alt="Zinfai logo">
        <span class="logo-text">ZINFAI</span>
    </a>
    <div class="nav-links">
        <a href="/features" data-nav="features">Features</a>
        <a href="/videos" data-nav="videos">Videos</a>
        <a href="/calculators" data-nav="calculators">Calculators</a>
        <a href="/buddy" data-nav="buddy">Zinfai Buddy</a>
        <a href="/support" data-nav="support">Support</a>
        <a href="/signin" data-nav="account" data-account-link>Sign in</a>
        <a class="btn" href="/download" data-nav="download">Download</a>
    </div>
</div>
</nav>`;

    const FOOTER_HTML = `
<footer id="contact">
<div class="container">
    <div class="footer-grid">
        <div class="footer-brand">
            <div class="footer-title">ZINFAI</div>
            <p>Your Financial Mirror. A multi-currency portfolio tracker that runs entirely on your own machine — your data never leaves it.</p>
        </div>
        <div class="footer-col">
            <h5>Product</h5>
            <a href="/features">Features</a>
            <a href="/videos">Video guides</a>
            <a href="/download">Download Zinfai</a>
            <a href="/buddy">Zinfai Buddy — Android</a>
            <a href="/register">Create an account</a>
        </div>
        <div class="footer-col">
            <h5>Calculators</h5>
            <a href="/calculators/fire">FIRE — when can I retire?</a>
            <a href="/calculators/sip">SIP — what will it grow to?</a>
            <a href="/calculators/emi">EMI — loan repayment</a>
            <a href="/calculators/rent-vs-buy">Rent vs Buy</a>
        </div>
        <div class="footer-col">
            <h5>Help</h5>
            <a href="/support">Support &amp; FAQ</a>
            <a href="/download#install-mac">Install on macOS</a>
            <a href="/download#install-windows">Install on Windows</a>
            <a href="/download#troubleshooting">Install troubleshooting</a>
        </div>
        <div class="footer-col">
            <h5>Company</h5>
            <a href="/#philosophy">Philosophy</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms of Use</a>
            <a href="mailto:support@zinfai.com">support@zinfai.com</a>
        </div>
    </div>
    <div class="copyright">
        © 2026 Zinfai · www.zinfai.com · All Rights Reserved.
    </div>
</div>
</footer>`;

    class SiteNav extends HTMLElement {
        connectedCallback() {
            this.innerHTML = NAV_HTML;
            const active = this.getAttribute("active");
            if (active) {
                const link = this.querySelector('[data-nav="' + active + '"]');
                if (link) link.setAttribute("aria-current", "page");
            }
        }
    }

    class SiteFooter extends HTMLElement {
        connectedCallback() {
            this.innerHTML = FOOTER_HTML;
        }
    }

    /* ---- YouTube videos, click to play ----
       <yt-video vid="wdFSOsY5U9M" title="Meet Zinfai" thumb="/videos/guides/intro.jpg"
                 duration="2:20" list="PLBjUjhUGK458"></yt-video>

       The privacy page promises no tracking scripts on this site, and a plain
       YouTube embed loads YouTube's player, scripts and cookies on every page
       view whether or not anyone watches. So the page shows our own thumbnail,
       and nothing is fetched from YouTube until the visitor presses play — then
       the player comes from youtube-nocookie.com. */
    function escapeAttr(s) {
        return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    }

    class YtVideo extends HTMLElement {
        connectedCallback() {
            if (this.dataset.ready) return;
            this.dataset.ready = "1";
            const vid = this.getAttribute("vid");
            const title = this.getAttribute("title") || "Zinfai video";
            const duration = this.getAttribute("duration");
            this.removeAttribute("title");  // no hover tooltip over the player
            this.innerHTML =
                '<button type="button" class="yt__play" aria-label="Play: ' + escapeAttr(title) + '">' +
                    '<img src="' + escapeAttr(this.getAttribute("thumb")) + '" alt="" loading="lazy">' +
                    '<span class="yt__icon" aria-hidden="true"></span>' +
                    (duration ? '<span class="yt__dur">' + escapeAttr(duration) + '</span>' : '') +
                '</button>';
            this.querySelector("button").addEventListener("click", () => {
                const iframe = document.createElement("iframe");
                // With a list, the player carries on into the next episode.
                const list = this.getAttribute("list");
                iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(vid) +
                             "?autoplay=1&rel=0&modestbranding=1" +
                             (list ? "&list=" + encodeURIComponent(list) : "");
                iframe.title = title;
                iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                iframe.allowFullscreen = true;
                this.innerHTML = "";
                this.appendChild(iframe);
            });
        }
    }

    customElements.define("site-nav", SiteNav);
    customElements.define("site-footer", SiteFooter);
    customElements.define("yt-video", YtVideo);

    /* ---- screenshots: self-revealing placeholders ----
       Every screenshot slot shows a styled placeholder until the real image
       is dropped into images/…, then the image takes over with no code change.
       Markup opts in via onerror="shotFallback(this)". */
    window.shotFallback = function (img) {
        img.style.display = "none";
        const frame = img.closest(".shot__frame");
        if (frame) frame.classList.add("is-empty");
    };

    function revealShots() {
        document.querySelectorAll(".shot__frame img").forEach(function (img) {
            function loaded() {
                const frame = img.closest(".shot__frame");
                if (frame) frame.classList.remove("is-empty");
                bindZoom(img);
            }
            if (img.complete && img.naturalWidth > 0) loaded();
            img.addEventListener("load", loaded);
        });
    }

    /* ---- lightbox: click any loaded screenshot to view it full size ---- */
    let lb = null, lbImg = null;

    function ensureLightbox() {
        if (lb) return;
        lb = document.createElement("div");
        lb.className = "lightbox";
        lb.setAttribute("role", "dialog");
        lb.setAttribute("aria-modal", "true");
        lb.innerHTML = '<button class="lightbox__close" aria-label="Close">&times;</button>' +
                       '<img class="lightbox__img" alt="">';
        document.body.appendChild(lb);
        lbImg = lb.querySelector(".lightbox__img");

        lb.addEventListener("click", function (e) {
            if (e.target === lb || e.target.classList.contains("lightbox__close")) closeLightbox();
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && lb.classList.contains("is-open")) closeLightbox();
        });
    }

    function closeLightbox() {
        lb.classList.remove("is-open");
        document.body.style.overflow = "";
    }

    function bindZoom(img) {
        if (img.dataset.zoomBound) return;
        img.dataset.zoomBound = "1";
        img.classList.add("is-zoomable");
        img.addEventListener("click", function () {
            ensureLightbox();
            lbImg.src = img.currentSrc || img.src;
            lbImg.alt = img.alt || "";
            lb.classList.add("is-open");
            document.body.style.overflow = "hidden";
        });
    }

    /* ---- copy-to-clipboard for install / Docker commands ---- */
    function bindCopyButtons() {
        document.querySelectorAll(".code-copy").forEach(function (btn) {
            btn.addEventListener("click", function () {
                const target = document.getElementById(btn.getAttribute("data-copy-target"));
                if (!target) return;
                const text = (target.textContent || "").trim();
                const done = function () {
                    const orig = btn.textContent;
                    btn.textContent = "Copied";
                    btn.classList.add("copied");
                    setTimeout(function () { btn.textContent = orig; btn.classList.remove("copied"); }, 1800);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done).catch(function () {});
                } else {
                    // Fallback for older / non-secure contexts
                    const ta = document.createElement("textarea");
                    ta.value = text; document.body.appendChild(ta); ta.select();
                    try { document.execCommand("copy"); done(); } catch (e) {}
                    document.body.removeChild(ta);
                }
            });
        });
    }

    /* ---- smooth-scroll same-page anchors ----
       Handles "#id" and "/#id" on the homepage alike. Delegated so it also
       covers the JS-rendered nav/footer links. */
    document.addEventListener("click", function (e) {
        const a = e.target.closest("a[href]");
        if (!a) return;
        const url = new URL(a.href, location.href);
        if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
        const target = document.querySelector(url.hash);
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: "smooth" });
        }
    });

    /* ---- version badges and file names ----
       The installers now live in a PRIVATE repo, so there is no public URL to
       put in an href and nothing here fetches one. What we still want on the
       page is the current version number and file name, which /api/manifest
       serves to anyone — it deliberately returns no URLs.

       Opt in from markup:
         <span data-download-version="zinfai">v1.0.2</span>
         <span data-download-file="zinfai:macos">Zinfai-v1.0.2.pkg</span>

       If the API can't be reached the hard-coded markup stays as-is, so the
       page never renders blank. */
    function applyManifest(name, m) {
        document.querySelectorAll('[data-download-file^="' + name + ':"]').forEach(function (el) {
            const platform = el.getAttribute("data-download-file").split(":")[1];
            const entry = m.platforms && m.platforms[platform];
            if (entry && entry.file) el.textContent = entry.file;
        });
        if (m.version) {
            document.querySelectorAll('[data-download-version="' + name + '"]').forEach(function (el) {
                el.textContent = "v" + m.version;
            });
        }
    }

    function hydrateDownloads() {
        const needed = new Set();
        document.querySelectorAll("[data-download]").forEach(function (el) {
            needed.add(el.getAttribute("data-download").split(":")[0]);
        });
        document.querySelectorAll("[data-download-file]").forEach(function (el) {
            needed.add(el.getAttribute("data-download-file").split(":")[0]);
        });
        document.querySelectorAll("[data-download-version]").forEach(function (el) {
            needed.add(el.getAttribute("data-download-version"));
        });

        needed.forEach(function (name) {
            fetch("/api/manifest?product=" + encodeURIComponent(name))
                .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
                .then(function (m) { applyManifest(name, m); })
                .catch(function () { /* keep the hard-coded fallback */ });
        });
    }

    /* ---- gated download buttons ----
       Every install button is a <button data-download="product:platform">, not
       a link — there is no URL to expose until the API mints one. Clicking it
       sends a signed-out or unverified visitor to /signin (which links on to
       registration), and a verified
       one straight to a short-lived GitHub URL.

       auth.js is an ES module and therefore deferred, so window.ZinfaiAuth may
       not exist while the page is still parsing. Every read of it happens
       inside a handler or an event, never at load time. */
    const SIGNIN_URL = "/signin?next=" +
        encodeURIComponent(location.pathname + location.hash);

    function setLabel(btn, text) {
        const label = btn.querySelector("[data-dl-label]");
        (label || btn).textContent = text;
    }

    /* ---- Terms of Use agreement ----
       /api/download refuses an account that has not accepted the current
       Terms of Use (code "terms-not-accepted", with the version it wants).
       This asks, with an unticked box the visitor has to tick themselves —
       a pre-ticked box, or "by clicking download you agree", is a much weaker
       agreement — and resolves true only on "Agree and download".
       `opts` re-titles it for the one other place it is used: a Google
       sign-in on the register page that turned out to create an account. */
    function askToAcceptTerms(product, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            const dlg = document.createElement("dialog");
            dlg.className = "terms-dialog";
            dlg.setAttribute("aria-labelledby", "terms-dialog-title");
            dlg.innerHTML =
                '<h3 id="terms-dialog-title">' + (opts.title || "Before you download") + '</h3>' +
                '<p>Zinfai is free, and is provided on these terms. Please read them, and confirm you agree.</p>' +
                '<ul>' +
                '<li><b>Not advice.</b> Zinfai is not financial, investment, tax or legal advice. Your decisions are your own.</li>' +
                '<li><b>As is.</b> It comes with no warranty, and our liability is limited.</li>' +
                '<li><b>Your data, your backups.</b> Everything stays on your device, so keeping it safe is up to you.</li>' +
                (product === "zinfai"
                    ? '<li><b>Docker Desktop.</b> Setup installs it if needed. It is Docker\'s software, under Docker\'s own licence, which requires a paid subscription in larger organisations.</li>'
                    : '') +
                '</ul>' +
                '<label class="terms-check"><input type="checkbox" id="terms-agree">' +
                '<span>I have read and agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Use</a> ' +
                'and the <a href="/privacy" target="_blank" rel="noopener">Privacy statement</a>.</span></label>' +
                '<div class="terms-actions">' +
                '<button type="button" class="btn ghost" data-terms="cancel">' + (opts.cancel || "Cancel") + '</button>' +
                '<button type="button" class="btn" data-terms="agree" disabled>' + (opts.agree || "Agree and download") + '</button>' +
                '</div>';
            document.body.appendChild(dlg);

            const box = dlg.querySelector("#terms-agree");
            const agree = dlg.querySelector('[data-terms="agree"]');
            let answer = false;
            box.addEventListener("change", function () { agree.disabled = !box.checked; });
            agree.addEventListener("click", function () { answer = box.checked; dlg.close(); });
            dlg.querySelector('[data-terms="cancel"]').addEventListener("click", function () { dlg.close(); });
            dlg.addEventListener("close", function () { dlg.remove(); resolve(answer); });
            dlg.showModal();
        });
    }

    /* Downloads, asking for the agreement when the server wants it. A 409
       "terms-changed" means the terms were updated while the dialog was
       open, so the visitor is asked again rather than signed up to text
       they never saw. */
    async function downloadWithTerms(auth, product, platform) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                return await auth.download(product, platform);
            } catch (err) {
                if (!err || err.code !== "terms-not-accepted") throw err;
                let version = err.termsVersion;
                for (;;) {
                    if (!(await askToAcceptTerms(product))) return null;
                    try {
                        await auth.acceptTerms(version, "download");
                        break;
                    } catch (e) {
                        if (!e || e.code !== "terms-changed") throw e;
                        version = e.termsVersion;
                    }
                }
            }
        }
        throw new Error("Download failed. Please try again.");
    }

    window.ZinfaiTerms = { ask: askToAcceptTerms };

    function bindDownloadButtons() {
        const buttons = document.querySelectorAll("button[data-download]");
        if (!buttons.length) return;

        /* Reflect the signed-in state in the button copy, so nobody clicks
           "Download" and gets bounced to a registration form unannounced. */
        function paint(user) {
            const verified = !!(user && user.emailVerified);
            buttons.forEach(function (btn) {
                if (btn.dataset.busy) return;
                setLabel(btn, verified ? btn.dataset.dlReady : btn.dataset.dlLocked);
                btn.classList.toggle("ghost", !verified);
            });
            document.querySelectorAll("[data-dl-hint]").forEach(function (el) {
                el.hidden = verified;
            });
        }

        /* Both labels have to exist before the first paint. `paint` reads
           `dlLocked`, and the fallback for `dlReady` reads the button's own
           text — so painting first wrote an undefined label into the button
           and then took the blank result as the "ready" copy. The button sat
           empty until auth.js announced a user, and stayed empty on any page
           where that never happened. */
        buttons.forEach(function (btn) {
            btn.dataset.dlReady = btn.dataset.dlReady || btn.textContent.trim();
            btn.dataset.dlLocked = btn.dataset.dlLocked || "Sign in to download";

            btn.addEventListener("click", function () {
                const auth = window.ZinfaiAuth;
                if (!auth || !auth.user || !auth.user.emailVerified) {
                    location.href = SIGNIN_URL;
                    return;
                }

                const parts = btn.getAttribute("data-download").split(":");
                btn.dataset.busy = "1";
                btn.disabled = true;
                setLabel(btn, "Preparing…");

                downloadWithTerms(auth, parts[0], parts[1])
                    .catch(function (err) {
                        if (err && err.code === "email-not-verified") {
                            location.href = SIGNIN_URL;
                            return;
                        }
                        alert(err && err.message ? err.message : "Download failed. Please try again.");
                    })
                    .finally(function () {
                        delete btn.dataset.busy;
                        btn.disabled = false;
                        paint(window.ZinfaiAuth && window.ZinfaiAuth.user);
                    });
            });
        });

        document.addEventListener("zinfai-auth", function (e) { paint(e.detail.user); });
        paint(null);
    }

    /* ---- nav account link ---- */
    function bindAccountLink() {
        document.addEventListener("zinfai-auth", function (e) {
            document.querySelectorAll("[data-account-link]").forEach(function (a) {
                a.textContent = e.detail.user ? "Account" : "Sign in";
            });
        });
    }

    function init() {
        revealShots();
        bindCopyButtons();
        hydrateDownloads();
        bindDownloadButtons();
        bindAccountLink();
    }

    if (document.readyState !== "loading") init();
    else document.addEventListener("DOMContentLoaded", init);
})();
