Zinfai desktop screenshots
==========================

Drop PNG files with these exact names into this folder. Each slot on the site
shows a styled placeholder until its file exists, then the real screenshot takes
over automatically — no HTML changes needed. (js/site.js does this via
shotFallback / revealShots.)

Required files
--------------
  hero.png                Main dashboard, used as the hero shot on the homepage.
  dashboard.png           Portfolio dashboard — valuation, gain/loss, allocation.
  assets-overview.png     Assets list grouped by category.
  statement.png           Statement upload / parsed-transactions screen.
  financial-freedom.png   FIRE projection with the year-by-year chart.
  financial-planner.png   AI Financial Planner — a generated plan.
  market-insight.png      Market Insight — indices, commodities, macro.
  asset-quality.png       Asset Quality ratings with scores and verdicts.

Capture guidance
----------------
  - Browser window at 1440 x 900 (or 1600 x 1000), dark theme, no browser chrome.
  - 2x / Retina capture is fine; the frames scale down cleanly.
  - Keep each file under ~500 KB. Run them through an optimiser (ImageOptim,
    squoosh.app, or `pngquant --quality 65-85`) before committing.
  - Use the demo user, not your real portfolio. Redact any account numbers,
    holder names or email addresses that remain.
  - Every screenshot must show the Zinfai branding — do NOT reuse the older
    PortAct Global screenshots, they carry the old wordmark.

This README.txt is excluded from deploys by firebase.json.
