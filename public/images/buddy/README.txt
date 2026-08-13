Zinfai Buddy (Android) screenshots
==================================

Drop PNG files with these exact names into this folder. Each slot on the site
shows a styled placeholder until its file exists, then the real screenshot takes
over automatically — no HTML changes needed.

Required files
--------------
  hero.png          Overview screen — used in the Buddy teaser on the homepage.
  overview.png      Overview — net worth hero, growth chart, allocation donut.
  portfolio.png     Holdings list with category tabs.
  expenses.png      Monthly expense trend and category donut.
  insights.png      Region indices, commodities, sentiment gauges.
  asset-detail.png  A single holding with its transaction history.

Capture guidance
----------------
  - Portrait phone screenshots, 1080 x 2400 or similar 9:19.5–9:16 ratio.
    The .shot__frame.phone / .phone-tall CSS frames expect portrait.
  - Light theme — the desktop Zinfai shots in images/zinfai/ are light, so dark
    phone shots sit oddly next to them. (Buddy's dark mode also draws the
    donut-chart centre in white, which is unreadable on a dark card.)
  - Hide the status-bar clutter if you can (demo mode); full status bar is OK.
  - Keep each file under ~400 KB — optimise before committing.
  - Use demo data. Redact real balances, holder names and account numbers.

This README.txt is excluded from deploys by firebase.json.
