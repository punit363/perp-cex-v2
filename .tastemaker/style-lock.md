# APEX Exchange style lock

Updated: 2026-11-11
Scope: landing and account access, market directory, balances, trading desk

## Current visual direction · 2026-11-11
- The user's new `design.md`, derived from the supplied APEX Markets screenshot, supersedes the older lime/orange palette notes below for the trade, landing, and account access pages. Preserve each page's existing layout and content.
- Canvas `#090b0d`, header `#0b0d10`, panels `#0e1014`, inset controls `#171a20`, fine borders `#20242c`, white text `#f2f3f5`, slate labels `#a0a9bb`, and muted text `#747f93`.
- Neutral selection uses `#252331` with `#c3b6ec` text or underline. Asset-specific colors remain on icons and trade charts; ETH is `#7187df`. Buy/bid and sell/ask retain semantic `#53bd8b` and `#d96379`.
- Use a quiet warm-brown unavailable-market notice. Keep landing and auth sections, trade panel geometry, and all unavailable-data placeholders intact. The account access page uses the same palette for sign-in and sign-up.
- Contrast checked on 2026-11-11: white on canvas 17.75:1; neutral selection on canvas 10.53:1; ETH periwinkle on canvas 5.85:1. Borders are decorative and cannot be the sole state cue.

## Market page correction · 2026-11-10
- Show five distinct featured markets in one compact row at desktop and 665px widths. Keep all five accessible on smaller screens with horizontal card scrolling.
- Make the market ticker a horizontally scrollable slider with previous and next controls and every available market pair.
- Remove the header search field. Quote, sort, and period controls remain in the content header.

## Trading view correction · 2026-11-10 05:51
- Move Account Balance to the upper right summary slot where Market Status sat. Profit and Loss remains above the order book on desktop.
- Extend the chart upward into the old Balance space. Keep the price and four market data cards in one horizontal row, and reduce the pair selector and price sizes to leave more height for the graph.
- At narrow widths, let that compact metric row scroll within the chart header while keeping the page itself free of horizontal overflow.

## Trading view correction · 2026-11-10
- The trading desk fills the viewport edge to edge on desktop. Remove the charcoal outer field and inset rounded frame.
- Match the supplied cropped chart header: pair selector and chart controls in the top row; prominent price and four compact metric cards below. Use All, Daily, Weekly, Monthly, and Yearly range controls.
- Align the market status panel's left edge with the execution panel's left edge at desktop widths. The summary row and main workspace share column measurements.
- Market cap and circulating supply remain unavailable until the exchange supplies them. The displayed high is qualified as the highest price in available candle history.

## Trading view override · 2026-11-10
- The user's Equilibrium dashboard screenshot defines the trading view composition. Omit its sidebar. Use a compact header and slim gradient status bar.
- First row: actual account balance, current position P&L, and market status. Main grid: chart at the far left, order book in the middle, order entry at the right. Put positions, current orders, order history, liquidations, and fundings directly below the chart.
- Dark graphite cards, thin near-black rules, orange chart line and selection state, restrained violet in the market-status card, green bids and buy, red asks and sell. Keep the operational type scale compact.
- Prices, P&L, positions, funding, orders, and depth come from the exchange. A chart drawing is allowed only for an unlisted preview pair and is explicitly labeled illustrative.

## Landing page override · 2026-11-10
- The six user supplied vertical screenshots are the landing page source of truth. This replaces the older split hero and short entry directions below for `/` only.
- Continuous near black vertical sequence: oversized hero over a receding dotted field; centered market discovery with a horizontal pair rail; large trading desk browser preview; two product panels; a compact capability grid; account entry and footer.
- White Inter display type, small monospaced green section labels, pale mint primary buttons, charcoal secondary controls, fine dividers, and restrained green market accents. No fabricated price, volume, latency, or uptime claims.
- Use live market data where available. The code native trading desk images are illustrative and labeled as previews.
- Scroll reveals use GSAP and one Lenis instance, with a static reduced motion path. Desktop sections remain spacious; mobile panels stack and chart previews adapt to a narrow viewport.
- Account access is a dedicated `/access` route. Keep the landing sequence focused on product discovery; route every sign-in, sign-up, and account-creation control to that page.
- Motion is restrained and explanatory: hero field parallax and product-preview drift follow the scroll, and the access route uses a short 16px entrance. Reduced-motion users receive the static composition.

## Market page override · 2026-11-10
- The user's two supplied screenshots are the market page source of truth. This overrides the older market-directory directions below; it does not change the landing, balances, or trading desk.
- Build the screenshot's central dashboard only: compact header and ticker strip, Live Crypto Updates title, three prominent BTC/ETH/SUI cards, and a dense Market Overview table. Omit the screenshot's left sidebar and right exchange/transaction panels.
- Market page palette: almost-black canvas and cards, graphite controls, muted grey text, restrained amber, violet, and cyan on featured cards. Rounded cards and controls match the supplied screenshots.
- Prices, change, volume, trades, and charts are sourced from the exchange API and stored candles. Empty states show absent data plainly.
- `apps/frontend/DESIGN.md` was removed at the user's request and has no authority for this page.

## Direction contract
- Thesis: a working perpetual exchange should read as one continuous trading desk, with market data and order entry given priority over decoration.
- First viewport: a concise promise and direct route to markets beside account access.
- System: near-black foundations, zinc panels, lime action and bid color, red ask color, compact Inter text with JetBrains Mono for prices and technical labels.
- Risk: over-density on small screens; preserve panel order and horizontal tab access instead of shrinking text indefinitely.

## Color contract
- Background `#0A0A0A`; surface `#18181B`; raised `#1E1E21`; chart `#111113`; border `#27272A` / `#303035`.
- Text `#FFFFFF` / `#F5F5F4`; secondary `#A1A1AA`; accent `#A3E635`; on-accent `#0A0A0A`; negative `#F07780`.
- Contrast matrix checked with `check_contrast.py` on 2026-11-09. Text-safe: text/background 19.80, text/surface 17.72, accent/background 13.13, accent/surface 11.75, on-accent/accent 13.13. Dark surface/border is decorative, not a sole state indicator. White on lime is prohibited.
- Dark mode only. No runtime toggle.

## Type and geometry
- Inter for headings, controls, prose. JetBrains Mono for labels, prices, percentages, chart axis, and order book data.
- Headline 50–88px desktop; section heads 28–42px; app panels 12–17px; tabular numerals for trading data.
- 8px base spacing; 8px controls, 12px market cards, 16px primary panels. One-pixel dividers define section boundaries.

## Structure and assets
- Structure: split account entry into a compact persistent app shell; market directory, collateral wallet, and four-zone trading desk share the same topbar and panel language. This is an operational app with a short public entry, so no marketing footer is used.
- Landing: product thesis and account access split. The only landing illustration is a code-native, two-step trading workflow; no fabricated volume or latency figures.
- App shell: persistent compact topbar, market directory, allocation wallet, and a sidebar-free trading cockpit. A short row of real collateral, 24h market, and funding summaries sits above the desk. The chart with its own pair and price header and the account activity table occupy the left; order book depth occupies the center; order entry occupies the right. Trading data remains sourced from existing API and WebSocket integration.
- Reuse existing APEX mark, SVG favicon, and coin icons unchanged.
- No photo or external illustration is needed for the data-driven app views. The market charts and wallet allocation are the primary visual assets.

## Motion
- Short entrance on landing and market list, state and hover feedback on controls. Trading panels stay spatially stable while live data updates. Reduced motion removes spatial movement.

## Do not
- Do not invent exchange metrics or performance claims.
- Do not hide order entry or market depth behind decorative marketing.
- Do not use purple gradients, glass panels, or oversized rounded cards.
