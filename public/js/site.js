/* =====================================================================
   Shared site chrome & helpers — single source of truth for every page.
   ---------------------------------------------------------------------
   Pages drop in <site-nav> and <site-footer> instead of copy-pasting the
   markup. Loaded synchronously from <head> so the custom elements are
   defined before the parser reaches them — the header renders in place
   with no flash.

   Usage:
     <site-nav active="download"></site-nav>   <!-- features | download | buddy | support -->
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
        <a href="/buddy" data-nav="buddy">Zinfai Buddy</a>
        <a href="/support" data-nav="support">Support</a>
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
            <a href="/download">Download Zinfai</a>
            <a href="/buddy">Zinfai Buddy — Android</a>
            <a href="/download#docker">Run with Docker</a>
        </div>
        <div class="footer-col">
            <h5>Help</h5>
            <a href="/support">Support &amp; FAQ</a>
            <a href="/download#install-mac">Install on macOS</a>
            <a href="/download#install-windows">Install on Windows</a>
            <a href="https://github.com/ZinfaiAdmin/zinfai-download/releases">Release history</a>
        </div>
        <div class="footer-col">
            <h5>Company</h5>
            <a href="/#philosophy">Philosophy</a>
            <a href="/privacy">Privacy</a>
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

    customElements.define("site-nav", SiteNav);
    customElements.define("site-footer", SiteFooter);

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

    /* ---- dynamic download links (read from the public downloads hub) ----
       Each product's release CI publishes a versioned installer to
       ZinfaiAdmin/zinfai-download and writes a small manifest there
       (manifest/<product>.json). We read it at page load and point the
       download button — plus any version badge or file name in an install
       command — at the exact current release, so the site always tracks the
       latest version with no per-release edit.

       Opt in from markup:
         <a data-download="zinfai:macos" href="...fallback...">
         <span data-download-version="zinfai">v1.0.2</span>
         <span data-download-file="zinfai:macos">Zinfai-v1.0.2.pkg</span>

       If the manifest can't be reached, the hard-coded markup stays as-is, so
       downloads never break. */
    const DOWNLOADS_MANIFEST_BASE =
        "https://raw.githubusercontent.com/ZinfaiAdmin/zinfai-download/main/manifest";

    function applyManifest(name, m) {
        document.querySelectorAll('a[data-download^="' + name + ':"]').forEach(function (a) {
            const platform = a.getAttribute("data-download").split(":")[1];
            const entry = m.platforms && m.platforms[platform];
            if (entry && entry.url) {
                a.href = entry.url;
                if (entry.file) a.setAttribute("download", entry.file);
            }
        });
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
        document.querySelectorAll("a[data-download]").forEach(function (a) {
            needed.add(a.getAttribute("data-download").split(":")[0]);
        });
        document.querySelectorAll("[data-download-file]").forEach(function (el) {
            needed.add(el.getAttribute("data-download-file").split(":")[0]);
        });
        document.querySelectorAll("[data-download-version]").forEach(function (el) {
            needed.add(el.getAttribute("data-download-version"));
        });

        needed.forEach(function (name) {
            fetch(DOWNLOADS_MANIFEST_BASE + "/" + name + ".json", { cache: "no-store" })
                .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
                .then(function (m) { applyManifest(name, m); })
                .catch(function () { /* keep the hard-coded fallback */ });
        });
    }

    function init() {
        revealShots();
        bindCopyButtons();
        hydrateDownloads();
    }

    if (document.readyState !== "loading") init();
    else document.addEventListener("DOMContentLoaded", init);
})();
