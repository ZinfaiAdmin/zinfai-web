/* =====================================================================
   Zinfai — calculator engine
   ---------------------------------------------------------------------
   Shared by every page under /calculators. Three things live here and
   nothing else; the financial models themselves stay on their own pages,
   where they can be read next to the assumptions they document.

     1. Money formatting that respects the reader's currency, including
        the lakh/crore grouping INR actually uses.
     2. Control binding — a number field and a slider that drive one
        value, plus segmented buttons, with reset and change events.
     3. An SVG chart renderer: stacked columns and lines, a crosshair
        tooltip, keyboard access, and a data table twin of every plot.

   No dependencies, no build step — same as the rest of the site.
   ===================================================================== */
(function () {
    "use strict";

    /* =================================================================
       CURRENCY & NUMBER FORMATTING
       ================================================================= */

    /* `group:"indian"` switches both the digit grouping (12,34,567) and the
       compact scale (lakh / crore) — the two go together and no other
       currency here uses either. */
    const CURRENCIES = {
        INR: { symbol: "₹",  locale: "en-IN", group: "indian",  name: "Indian rupee" },
        USD: { symbol: "$",  locale: "en-US", group: "western", name: "US dollar" },
        GBP: { symbol: "£",  locale: "en-GB", group: "western", name: "Pound sterling" },
        EUR: { symbol: "€",  locale: "en-IE", group: "western", name: "Euro" },
        AED: { symbol: "AED", locale: "en-AE", group: "western", name: "UAE dirham", space: true },
        AUD: { symbol: "A$", locale: "en-AU", group: "western", name: "Australian dollar" },
        SGD: { symbol: "S$", locale: "en-SG", group: "western", name: "Singapore dollar" },
        CAD: { symbol: "C$", locale: "en-CA", group: "western", name: "Canadian dollar" }
    };

    const STORE_KEY = "zinfai-calc-currency";
    let currency = "INR";

    try {
        const saved = localStorage.getItem(STORE_KEY);
        if (saved && CURRENCIES[saved]) currency = saved;
    } catch (e) { /* private mode — fall back to the default */ }

    function cur() { return CURRENCIES[currency]; }

    function symbol() {
        const c = cur();
        return c.space ? c.symbol + " " : c.symbol;
    }

    function grouped(n) {
        return new Intl.NumberFormat(cur().locale, { maximumFractionDigits: 0 }).format(n);
    }

    /* Full value with symbol — what tooltips, tiles and tables show. */
    function money(v) {
        if (!isFinite(v)) return "—";
        const sign = v < 0 ? "-" : "";
        return sign + symbol() + grouped(Math.round(Math.abs(v)));
    }

    /* Short value for axis ticks and hero figures, where the exact rupee
       is noise. INR uses lakh and crore; everything else uses K/M/B. */
    function compact(v, withSymbol) {
        if (!isFinite(v)) return "—";
        const sign = v < 0 ? "-" : "";
        const a = Math.abs(v);
        const pre = withSymbol === false ? "" : symbol();
        let out;

        if (cur().group === "indian") {
            if (a >= 1e7)      out = trim(a / 1e7) + " Cr";
            else if (a >= 1e5) out = trim(a / 1e5) + " L";
            else if (a >= 1e3) out = trim(a / 1e3) + " K";
            else               out = String(Math.round(a));
        } else {
            if (a >= 1e9)      out = trim(a / 1e9) + "B";
            else if (a >= 1e6) out = trim(a / 1e6) + "M";
            else if (a >= 1e3) out = trim(a / 1e3) + "K";
            else               out = String(Math.round(a));
        }
        return sign + pre + out;
    }

    /* Two decimals below 10, one below 100, none above — so 1.25 Cr and
       12.5 L and 250 K all read at about the same information density. */
    function trim(n) {
        const d = n < 10 ? 2 : (n < 100 ? 1 : 0);
        return n.toFixed(d).replace(/\.?0+$/, "");
    }

    function pct(v, d) {
        return v.toFixed(d === undefined ? 1 : d) + "%";
    }

    /* "7 years 4 months" — used wherever a duration is the answer. */
    function months(m) {
        m = Math.max(0, Math.round(m));
        const y = Math.floor(m / 12), r = m % 12;
        const parts = [];
        if (y) parts.push(y + (y === 1 ? " year" : " years"));
        if (r) parts.push(r + (r === 1 ? " month" : " months"));
        return parts.length ? parts.join(" ") : "0 months";
    }

    const listeners = [];

    function setCurrency(code) {
        if (!CURRENCIES[code] || code === currency) return;
        currency = code;
        try { localStorage.setItem(STORE_KEY, code); } catch (e) { /* ignore */ }
        document.querySelectorAll("[data-cur-symbol]").forEach(function (el) {
            el.textContent = cur().symbol;
        });
        document.querySelectorAll("select[data-currency]").forEach(function (s) {
            s.value = code;
        });
        listeners.forEach(function (fn) { fn(code); });
    }

    /* Fills every <select data-currency> on the page and keeps them in sync. */
    function mountCurrency() {
        document.querySelectorAll("select[data-currency]").forEach(function (sel) {
            if (!sel.options.length) {
                Object.keys(CURRENCIES).forEach(function (code) {
                    const o = document.createElement("option");
                    o.value = code;
                    o.textContent = code + " — " + CURRENCIES[code].name;
                    sel.appendChild(o);
                });
            }
            sel.value = currency;
            sel.addEventListener("change", function () { setCurrency(sel.value); });
        });
        document.querySelectorAll("[data-cur-symbol]").forEach(function (el) {
            el.textContent = cur().symbol;
        });
    }

    /* =================================================================
       CONTROLS
       ================================================================= */

    /* Binds every control inside `root` and calls `onChange(values)` once
       immediately, then on every edit (coalesced to one call per frame).

       Markup contract:
         <input data-field="rate" type="number" min max step value>
         <input data-range="rate" type="range" min max step value>
         <div data-seg="unit"><button data-val="years" …></div>

       A field and a range sharing a name drive the same value. The number
       box is authoritative while it has focus, so typing "5" on the way to
       "50" is never yanked up to the minimum mid-keystroke; the clamp
       happens on blur. */
    /* Money sliders have to span four or five orders of magnitude — ₹500 a
       month up to ₹5,00,000 — and the same track has to stay usable when the
       currency is switched to dollars, because the numbers are typed, not
       converted. On a linear track every realistic value is crushed into the
       left tenth of it. A range marked data-log keeps its declared min/max as
       the value domain but drives the thumb along an exponential curve, which
       lands a typical value near the middle and still reaches the top end. */
    const LOG_K = 6;
    const LOG_STEPS = 1000;
    const LOG_E = Math.exp(LOG_K) - 1;

    const LINEAR = {
        toPos: function (v) { return v; },
        fromPos: function (p) { return Number(p); }
    };

    function logScale(r) {
        const lo = Number(r.min), hi = Number(r.max);
        const declared = Number(r.step) || 1;
        /* Read the markup's value= before rewriting the domain, or the browser
           clamps it to the new max on the way past. */
        const start = Number(r.value);
        /* The element's own domain becomes the slider position; the value
           domain lives in the closure from here on. */
        r.min = "0"; r.max = String(LOG_STEPS); r.step = "1";
        const sc = {
            start: start,
            toPos: function (v) {
                const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
                return Math.round(LOG_STEPS * Math.log(1 + f * LOG_E) / LOG_K);
            },
            fromPos: function (p) {
                const f = (Math.exp(LOG_K * (p / LOG_STEPS)) - 1) / LOG_E;
                const v = lo + f * (hi - lo);
                /* Snap to a step that suits the magnitude, so dragging yields
                   ₹25,000 rather than ₹25,341 — but never finer than the step
                   the page asked for. Both ends land exactly on lo and hi. */
                const mag = v > 0 ? Math.pow(10, Math.floor(Math.log10(v)) - 1) : declared;
                const step = Math.max(declared, mag);
                return Math.round(v / step) * step;
            }
        };
        r.value = sc.toPos(start);
        return sc;
    }

    function form(root, onChange) {
        root = typeof root === "string" ? document.querySelector(root) : root;
        const values = {};
        const initial = {};
        const scales = {};
        let queued = false;

        function fire() {
            if (queued) return;
            queued = true;
            requestAnimationFrame(function () {
                queued = false;
                onChange(values);
            });
        }

        function paintRange(r) {
            const min = Number(r.min), max = Number(r.max);
            const p = max > min ? ((Number(r.value) - min) / (max - min)) * 100 : 0;
            r.style.setProperty("--fill", Math.max(0, Math.min(100, p)) + "%");
        }

        function clamp(el, v) {
            if (el.min !== "" && v < Number(el.min)) v = Number(el.min);
            if (el.max !== "" && v > Number(el.max)) v = Number(el.max);
            return v;
        }

        root.querySelectorAll("[data-field]").forEach(function (el) {
            const name = el.dataset.field;
            const range = root.querySelector('[data-range="' + name + '"]');
            const isNum = el.type === "number";
            const sc = range && range.hasAttribute("data-log") ? logScale(range) : LINEAR;
            scales[name] = sc;

            function read() {
                if (!isNum) return el.value;
                const raw = parseFloat(el.value);
                return isNaN(raw) ? Number(el.min || 0) : clamp(el, raw);
            }

            values[name] = read();
            initial[name] = el.value;

            el.addEventListener("input", function () {
                values[name] = read();
                if (range) { range.value = sc.toPos(values[name]); paintRange(range); }
                fire();
            });
            /* Snap the visible text to the clamped value only once the user
               has stopped typing in it. */
            el.addEventListener("blur", function () {
                if (isNum) el.value = String(read());
            });

            if (range) {
                range.value = sc.toPos(values[name]);
                paintRange(range);
                range.addEventListener("input", function () {
                    values[name] = sc.fromPos(range.value);
                    el.value = String(values[name]);
                    paintRange(range);
                    fire();
                });
            }
        });

        /* Sliders with no number box of their own. */
        root.querySelectorAll("[data-range]").forEach(function (r) {
            const name = r.dataset.range;
            if (name in values) return;
            const sc = r.hasAttribute("data-log") ? logScale(r) : LINEAR;
            scales[name] = sc;
            values[name] = sc.start !== undefined ? sc.start : sc.fromPos(r.value);
            initial[name] = values[name];
            paintRange(r);
            r.addEventListener("input", function () {
                values[name] = sc.fromPos(r.value);
                paintRange(r);
                fire();
            });
        });

        root.querySelectorAll("[data-seg]").forEach(function (seg) {
            const name = seg.dataset.seg;
            const btns = Array.prototype.slice.call(seg.querySelectorAll("button"));
            const active = btns.find(function (b) { return b.getAttribute("aria-pressed") === "true"; }) || btns[0];
            values[name] = active.dataset.val;
            initial[name] = active.dataset.val;

            btns.forEach(function (b) {
                b.addEventListener("click", function () {
                    btns.forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
                    values[name] = b.dataset.val;
                    fire();
                });
            });
        });

        root.querySelectorAll("[data-reset]").forEach(function (btn) {
            btn.addEventListener("click", function () {
                root.querySelectorAll("[data-field]").forEach(function (el) {
                    el.value = initial[el.dataset.field];
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                });
                root.querySelectorAll("[data-range]").forEach(function (r) {
                    const name = r.dataset.range;
                    if (!(name in initial)) return;
                    /* initial holds values, the element holds positions. */
                    r.value = (scales[name] || LINEAR).toPos(Number(initial[name]));
                    r.dispatchEvent(new Event("input", { bubbles: true }));
                });
                root.querySelectorAll("[data-seg]").forEach(function (seg) {
                    const want = initial[seg.dataset.seg];
                    const b = seg.querySelector('[data-val="' + want + '"]');
                    if (b) b.click();
                });
            });
        });

        onChange(values);
        return { values: values, refresh: fire };
    }

    /* =================================================================
       CHART
       ================================================================= */

    const NS = "http://www.w3.org/2000/svg";
    const GAP = 2;            /* surface gap between stacked segments      */
    const BAR_MAX = 24;       /* mark spec: bars never fill their band     */
    const PLOT_H = 250;
    const PAD = { t: 18, r: 18, b: 40 };

    function el(tag, attrs) {
        const n = document.createElementNS(NS, tag);
        for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
        return n;
    }

    /* Rounded at the data end, square at the baseline. */
    function capPath(x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h));
        return "M" + x + "," + (y + h) +
               "L" + x + "," + (y + r) +
               "Q" + x + "," + y + " " + (x + r) + "," + y +
               "L" + (x + w - r) + "," + y +
               "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) +
               "L" + (x + w) + "," + (y + h) + "Z";
    }

    /* Clean tick values — 0 / 20L / 40L, never 0 / 17.3L / 34.6L. */
    function niceScale(min, max, count) {
        if (max === min) max = min + 1;
        const raw = (max - min) / count;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const norm = raw / mag;
        const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
        const lo = Math.floor(min / step) * step;
        const hi = Math.ceil(max / step) * step;
        const ticks = [];
        for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
        return { min: lo, max: hi, ticks: ticks };
    }

    /* A chart owns one card: legend, plot, tooltip and table. Call
       `render(spec)` as often as you like — it redraws from scratch, which
       at these data sizes is far cheaper than diffing.

       spec = {
         type:   "stack" | "line",
         x:      [labels…],           // one per column / point
         series: [{ name, values, color, kind:"line"|"area", label }],
         xTitle, yTitle,
         xLabel(i)  -> tooltip / table row heading
         markers:   [{ i, label }]    // vertical annotation, e.g. FIRE year
         total:     "Total"           // adds a summed row to stack tooltips
         tableX:    column heading for the x column
       } */
    function chart(card) {
        card = typeof card === "string" ? document.querySelector(card) : card;
        const legendEl = card.querySelector("[data-legend]");
        const plotEl = card.querySelector("[data-plot]");
        const tableEl = card.querySelector("[data-table]");

        const tip = document.createElement("div");
        tip.className = "chart-tip";
        tip.setAttribute("role", "status");
        plotEl.appendChild(tip);

        let spec = null;
        let hot = -1;          /* hovered / focused index */
        let geom = null;

        const ro = new ResizeObserver(function () { if (spec) draw(); });
        ro.observe(plotEl);

        function fmt(v) { return spec.format ? spec.format(v) : money(v); }
        function tick(v) { return spec.tick ? spec.tick(v) : compact(v); }

        function render(next) {
            spec = next;
            hot = -1;
            drawLegend();
            draw();
            drawTable();
        }

        function drawLegend() {
            if (!legendEl) return;
            legendEl.textContent = "";
            /* One series needs no legend box — the chart's own heading
               already names what is plotted. */
            if (spec.series.length < 2) return;
            spec.series.forEach(function (s) {
                const item = document.createElement("span");
                item.className = "item";
                const sw = document.createElement("span");
                sw.className = "swatch" + (spec.type === "line" ? " line" : "");
                sw.style.setProperty("--k", s.color);
                const txt = document.createElement("span");
                txt.textContent = s.name;
                item.appendChild(sw);
                item.appendChild(txt);
                legendEl.appendChild(item);
            });
        }

        function draw() {
            const old = plotEl.querySelector("svg");
            if (old) old.remove();

            const W = Math.max(280, plotEl.clientWidth);
            const n = spec.x.length;
            if (!n) return;

            /* Y domain. Stacks measure column totals; lines measure each
               series, and are allowed below zero if the data goes there. */
            let lo = 0, hi = 0;
            if (spec.type === "stack") {
                for (let i = 0; i < n; i++) {
                    let t = 0;
                    spec.series.forEach(function (s) { t += s.values[i] || 0; });
                    if (t > hi) hi = t;
                }
            } else {
                spec.series.forEach(function (s) {
                    s.values.forEach(function (v) {
                        if (!isFinite(v)) return;
                        if (v > hi) hi = v;
                        if (v < lo) lo = v;
                    });
                });
            }
            const sc = niceScale(lo, hi, 5);

            /* Left padding follows the widest tick label, so a crore-scale
               chart and a thousands-scale one both sit flush. */
            const labels = sc.ticks.map(tick);
            const widest = labels.reduce(function (m, s) { return Math.max(m, s.length); }, 0);
            const padL = Math.ceil(widest * 6.7) + 14;

            const H = PLOT_H + PAD.t + PAD.b;
            const iw = W - padL - PAD.r;
            const ih = PLOT_H;

            const svg = el("svg", {
                width: W, height: H, viewBox: "0 0 " + W + " " + H,
                role: "img", tabindex: "0",
                "aria-label": spec.aria || "Chart. The same figures are listed in the data table below."
            });

            const x0 = padL, y0 = PAD.t;
            const yOf = function (v) { return y0 + ih - ((v - sc.min) / (sc.max - sc.min)) * ih; };
            const band = iw / n;
            const xOf = spec.type === "stack"
                ? function (i) { return x0 + band * (i + 0.5); }
                : function (i) { return n === 1 ? x0 + iw / 2 : x0 + (iw * i) / (n - 1); };

            /* --- grid + y axis (hairline, solid, recessive) --- */
            sc.ticks.forEach(function (v, k) {
                const y = yOf(v);
                svg.appendChild(el("line", {
                    x1: x0, x2: x0 + iw, y1: y, y2: y,
                    class: v === 0 ? "axis-line" : "grid-line"
                }));
                const t = el("text", { x: x0 - 9, y: y + 4, class: "axis-text", "text-anchor": "end" });
                t.textContent = labels[k];
                svg.appendChild(t);
            });

            /* --- x ticks: at most 8, always including the last --- */
            const stride = Math.max(1, Math.ceil(n / 8));
            for (let i = 0; i < n; i++) {
                if (i % stride !== 0 && i !== n - 1) continue;
                if (i !== n - 1 && n - 1 - i < stride * 0.6) continue;
                const t = el("text", {
                    x: xOf(i), y: y0 + ih + 20, class: "axis-text", "text-anchor": "middle"
                });
                t.textContent = spec.x[i];
                svg.appendChild(t);
            }
            if (spec.xTitle) {
                const t = el("text", {
                    x: x0 + iw / 2, y: H - 4, class: "axis-title", "text-anchor": "middle"
                });
                t.textContent = spec.xTitle;
                svg.appendChild(t);
            }

            /* --- marks --- */
            if (spec.type === "stack") {
                const bw = Math.min(BAR_MAX, band * 0.62);
                for (let i = 0; i < n; i++) {
                    let acc = 0;
                    const bx = xOf(i) - bw / 2;
                    /* Find the topmost non-empty segment so only it gets the
                       rounded data-end. */
                    let topIdx = -1;
                    spec.series.forEach(function (s, si) { if ((s.values[i] || 0) > 0) topIdx = si; });

                    spec.series.forEach(function (s, si) {
                        const v = s.values[i] || 0;
                        if (v <= 0) return;
                        const yTop = yOf(acc + v);
                        const yBot = yOf(acc);
                        acc += v;
                        /* The 2px surface gap is taken off the top of every
                           segment that carries another one above it — the gap
                           does the separating, never a stroke. */
                        const hasAbove = si !== topIdx;
                        const y = hasAbove ? yTop + GAP : yTop;
                        const h = yBot - y;
                        if (h <= 0.4) return;
                        svg.appendChild(el("path", {
                            d: si === topIdx ? capPath(bx, y, bw, h, 4) : capPath(bx, y, bw, h, 0),
                            fill: s.color
                        }));
                    });
                }
            } else {
                spec.series.forEach(function (s) {
                    const pts = [];
                    for (let i = 0; i < n; i++) {
                        const v = s.values[i];
                        if (isFinite(v)) pts.push([xOf(i), yOf(v)]);
                    }
                    if (!pts.length) return;

                    if (s.kind === "area") {
                        const base = yOf(Math.max(sc.min, 0));
                        let d = "M" + pts[0][0] + "," + base;
                        pts.forEach(function (p) { d += "L" + p[0] + "," + p[1]; });
                        d += "L" + pts[pts.length - 1][0] + "," + base + "Z";
                        svg.appendChild(el("path", { d: d, fill: s.color, "fill-opacity": ".10" }));
                    }
                    svg.appendChild(el("path", {
                        d: pts.map(function (p, i) { return (i ? "L" : "M") + p[0] + "," + p[1]; }).join(""),
                        fill: "none", stroke: s.color, "stroke-width": 2,
                        "stroke-linejoin": "round", "stroke-linecap": "round"
                    }));

                    /* Direct label on the endpoint only — never a number on
                       every point. The ring keeps the dot legible where the
                       two lines cross. */
                    const last = pts[pts.length - 1];
                    svg.appendChild(el("circle", {
                        cx: last[0], cy: last[1], r: 4.5, fill: s.color,
                        stroke: "var(--chart-surface)", "stroke-width": 2
                    }));
                });
            }

            /* --- markers (break-even year, FIRE year) --- */
            (spec.markers || []).forEach(function (m) {
                if (m.i == null || m.i < 0 || m.i >= n) return;
                const mx = xOf(m.i);
                svg.appendChild(el("line", {
                    x1: mx, x2: mx, y1: y0, y2: y0 + ih, class: "marker-line"
                }));
                const anchor = mx > x0 + iw * 0.72 ? "end" : "start";
                const t = el("text", {
                    x: mx + (anchor === "end" ? -7 : 7), y: y0 + 11,
                    class: "marker-text", "text-anchor": anchor
                });
                t.textContent = m.label;
                svg.appendChild(t);
            });

            /* --- hover layer ---
               Hit rects tile the whole plot, one per x position, so the
               pointer only has to be nearest — never dead on a 2px line. */
            const hover = el("g", {});
            const cross = el("line", { class: "crosshair", y1: y0, y2: y0 + ih, opacity: 0 });
            hover.appendChild(cross);
            const dots = el("g", { opacity: 0 });
            hover.appendChild(dots);
            spec.series.forEach(function (s) {
                dots.appendChild(el("circle", {
                    r: 4.5, fill: s.color, stroke: "var(--chart-surface)", "stroke-width": 2
                }));
            });

            for (let i = 0; i < n; i++) {
                const hx = spec.type === "stack" ? x0 + band * i : x0 + (i - 0.5) * (iw / Math.max(1, n - 1));
                const hw = spec.type === "stack" ? band : iw / Math.max(1, n - 1);
                const r = el("rect", {
                    x: Math.max(x0, hx), y: y0,
                    width: Math.max(1, Math.min(hw, x0 + iw - Math.max(x0, hx))), height: ih,
                    fill: "transparent"
                });
                r.dataset.i = i;
                hover.appendChild(r);
            }
            svg.appendChild(hover);

            geom = { xOf: xOf, yOf: yOf, cross: cross, dots: dots, n: n, W: W };

            svg.addEventListener("pointermove", function (e) {
                const t = e.target;
                if (t.dataset && t.dataset.i !== undefined) show(Number(t.dataset.i));
            });
            svg.addEventListener("pointerleave", hide);
            svg.addEventListener("blur", hide);
            svg.addEventListener("focus", function () { show(hot < 0 ? n - 1 : hot); });
            svg.addEventListener("keydown", function (e) {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const next = (hot < 0 ? n - 1 : hot) + (e.key === "ArrowRight" ? 1 : -1);
                    show(Math.max(0, Math.min(n - 1, next)));
                } else if (e.key === "Escape") { hide(); }
            });

            plotEl.insertBefore(svg, tip);
            if (hot >= 0) show(hot);
        }

        function show(i) {
            hot = i;
            const xp = geom.xOf(i);
            geom.cross.setAttribute("x1", xp);
            geom.cross.setAttribute("x2", xp);
            geom.cross.setAttribute("opacity", spec.type === "line" ? 1 : 0);

            if (spec.type === "line") {
                geom.dots.setAttribute("opacity", 1);
                Array.prototype.forEach.call(geom.dots.children, function (c, si) {
                    const v = spec.series[si].values[i];
                    if (!isFinite(v)) { c.setAttribute("opacity", 0); return; }
                    c.setAttribute("opacity", 1);
                    c.setAttribute("cx", xp);
                    c.setAttribute("cy", geom.yOf(v));
                });
            } else {
                geom.dots.setAttribute("opacity", 0);
            }

            /* Untrusted-by-default: every label goes in as text, never HTML. */
            tip.textContent = "";
            const head = document.createElement("div");
            head.className = "tip-x";
            head.textContent = spec.xLabel ? spec.xLabel(i) : spec.x[i];
            tip.appendChild(head);

            let total = 0;
            spec.series.forEach(function (s) {
                const v = s.values[i];
                total += isFinite(v) ? v : 0;
                const row = document.createElement("div");
                row.className = "tip-row";
                const key = document.createElement("span");
                key.className = "tip-key";
                key.style.setProperty("--k", s.color);
                const nm = document.createElement("span");
                nm.className = "tip-name";
                nm.textContent = s.name;
                const val = document.createElement("span");
                val.className = "tip-val";
                val.textContent = isFinite(v) ? fmt(v) : "—";
                row.appendChild(key); row.appendChild(nm); row.appendChild(val);
                tip.appendChild(row);
            });

            if (spec.total && spec.series.length > 1) {
                const row = document.createElement("div");
                row.className = "tip-row tip-total";
                const nm = document.createElement("span");
                nm.className = "tip-name";
                nm.textContent = spec.total;
                const val = document.createElement("span");
                val.className = "tip-val";
                val.textContent = fmt(total);
                row.appendChild(nm); row.appendChild(val);
                tip.appendChild(row);
            }

            tip.classList.add("is-open");
            /* Keep the bubble inside the card near either edge. */
            const tw = tip.offsetWidth;
            const left = Math.max(tw / 2 + 2, Math.min(geom.W - tw / 2 - 2, xp));
            tip.style.left = left + "px";
            tip.style.top = (PAD.t - 8) + "px";
        }

        function hide() {
            hot = -1;
            tip.classList.remove("is-open");
            if (geom) {
                geom.cross.setAttribute("opacity", 0);
                geom.dots.setAttribute("opacity", 0);
            }
        }

        /* The table is the chart's accessible twin — same numbers, no
           hovering, no colour needed to read it. */
        function drawTable() {
            if (!tableEl) return;
            tableEl.textContent = "";
            const t = document.createElement("table");
            t.className = "calc-table";

            /* Columns that give the table context the plot deliberately
               leaves out — a closing balance beside the payments, say.
               Never plotted: a second measure on the same axes would be a
               dual-axis chart by the back door. */
            const extra = spec.extraCols || [];

            const thead = document.createElement("thead");
            const hr = document.createElement("tr");
            [spec.tableX || spec.xTitle || ""].concat(spec.series.map(function (s) { return s.name; }))
                .concat(spec.total && spec.series.length > 1 ? [spec.total] : [])
                .concat(extra.map(function (c) { return c.name; }))
                .forEach(function (label) {
                    const th = document.createElement("th");
                    th.scope = "col";
                    th.textContent = label;
                    hr.appendChild(th);
                });
            thead.appendChild(hr);
            t.appendChild(thead);

            const tb = document.createElement("tb" + "ody");
            spec.x.forEach(function (xv, i) {
                const tr = document.createElement("tr");
                const th = document.createElement("th");
                th.scope = "row";
                th.textContent = spec.xLabel ? spec.xLabel(i) : xv;
                tr.appendChild(th);
                let total = 0;
                spec.series.forEach(function (s) {
                    const v = s.values[i];
                    total += isFinite(v) ? v : 0;
                    const td = document.createElement("td");
                    td.textContent = isFinite(v) ? fmt(v) : "—";
                    tr.appendChild(td);
                });
                if (spec.total && spec.series.length > 1) {
                    const td = document.createElement("td");
                    td.textContent = fmt(total);
                    tr.appendChild(td);
                }
                extra.forEach(function (c) {
                    const td = document.createElement("td");
                    const cv = c.values[i];
                    td.textContent = c.format ? c.format(cv) : (isFinite(cv) ? fmt(cv) : "—");
                    tr.appendChild(td);
                });
                tb.appendChild(tr);
            });
            t.appendChild(tb);
            tableEl.appendChild(t);
        }

        return { render: render };
    }

    /* =================================================================
       SMALL SHARED MATH
       ================================================================= */

    /* Level payment on an amortising loan. `i` is the periodic rate. */
    function payment(principal, i, n) {
        if (n <= 0) return 0;
        if (i === 0) return principal / n;
        const g = Math.pow(1 + i, n);
        return (principal * i * g) / (g - 1);
    }

    /* Writes a value into every [data-out="name"] on the page. */
    function out(name, text) {
        document.querySelectorAll('[data-out="' + name + '"]').forEach(function (el) {
            el.textContent = text;
        });
    }

    window.Calc = {
        money: money,
        compact: compact,
        grouped: grouped,
        pct: pct,
        months: months,
        symbol: symbol,
        currency: function () { return currency; },
        setCurrency: setCurrency,
        mountCurrency: mountCurrency,
        onCurrencyChange: function (fn) { listeners.push(fn); },
        form: form,
        chart: chart,
        payment: payment,
        out: out
    };

    if (document.readyState !== "loading") mountCurrency();
    else document.addEventListener("DOMContentLoaded", mountCurrency);
})();
