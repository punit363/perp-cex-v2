# APEX Exchange visual reference

This guide extracts the visual language of the user-supplied **APEX Markets** screenshot dated 11 November 2026. It is a style source for a trade-view image, not a layout template. Keep the current trade page's exact structure, coordinates, text, chart path, and empty states.

## Visual character

An almost-black exchange interface with bright white primary text, slate-blue secondary text, thin cool borders, and low-contrast charcoal controls. The page is calm and technical. Color belongs mainly to asset icons and narrow asset indicators; neutral controls do not adopt a global green or orange accent. A soft violet tint identifies selected neutral filters. A warm brown strip communicates a service warning without dominating the page.

## Reference palette

These are visual estimates from the screenshot, not extracted source CSS.

| Role | Color | Application |
| --- | --- | --- |
| Canvas | `#090b0d` | Open page background |
| Header | `#0b0d10` | Main navigation background |
| Card | `#0e1014` | Market cards and trade panels |
| Raised control | `#171a20` | Inputs, dropdowns, action shells |
| Border | `#20242c` | 1 px panel and control outline |
| Divider | `#1b2027` | Internal rows and table lines |
| Primary text | `#f2f3f5` | Titles, prices, active values |
| Secondary text | `#a0a9bb` | Labels and navigation |
| Muted text | `#747f93` | Descriptions and empty states |
| Selected neutral fill | `#252331` | Selected filter or period |
| Selected neutral text | `#c3b6ec` | Selected filter label |
| Warning fill | `#1c1915` | Service-unavailable notice |
| Warning border | `#3a3429` | Notice outline |
| Warning text | `#b9b1a5` | Notice message |
| Positive | `#53bd8b` | Available favorable trading state only |
| Negative | `#d96379` | Available unfavorable trading state only |

## Asset color language

The screenshot assigns each coin a distinct accent. BTC uses amber `#f6a126`; ETH uses periwinkle `#7187df`; SUI uses cyan `#68bde0`; SOL uses mint with violet; DOGE uses warm yellow and pink. On the ETH/USDT trade preview, use the ETH periwinkle for its icon, chart trace, chart fill, and small pair-specific indicators. Keep buy and sell semantics green and red where those controls already exist. The selected time period and neutral tabs use the muted violet treatment.

## Typography and surfaces

- Keep the frontend's existing font family, weights, sizes, line heights, letter spacing, and text strings in the preview; font metric changes would move content.
- Use white for the most important values, blue-gray for labels, and subdued gray-blue for unavailable data. Never replace unavailable values with fabricated prices.
- Panels have flat fills, subtle 1 px cool borders, and the current corner radii. Avoid large glows, gradients, glass effects, and deep shadows.
- Selected controls use restrained fills or thin underlines in the reference's muted violet. The narrow accent for the selected ETH pair can be periwinkle.
- The reference's market cards have asset-colored icons and a slim vertical price marker. Translate that color relationship to existing trade components without importing the five-card grid.

## Trade-view application

| Existing trade component | Style interpretation |
| --- | --- |
| Header and navigation | Almost-black band; white brand, slate secondary copy, charcoal button shells. |
| Preview notice | Warm dark-brown fill with faint brown border and muted warm text. |
| ETH pair control | Keep exact button and icon size; retain ETH's periwinkle icon and use only a small blue accent. |
| Chart and four market data cards | Same near-black card surfaces and fine borders as the market screenshot. Keep the exact chart curve, grid, and four-card row; recolor the illustrative curve to ETH periwinkle with a faint blue fill. |
| P&L and balance | Flat dark cards with white values and slate labels. Preserve signed-out placeholders. |
| Order book | Cool, quiet dividers. Keep empty asks and bids. Use red/green only if real ask/bid rows exist. |
| Place order | Charcoal inputs and segmented controls. Selected neutral type gets violet; buy and sell retain their semantic green/red colors. |
| Positions and activity | Existing tab order, table area, and empty state. Active neutral tab gets a thin violet underline. |

## Geometry rule

The current ETH trade screenshot is the sole source of trade-page geometry and content. Do not copy the markets screenshot's navigation layout, ticker, five cards, filters, table, or copy into the trade page. Preserve the position and size of every panel, chart, field, tab, label, icon, and empty state. Change only surface colors, border colors, chart colors, and state accents. The landing and access pages retain their existing section and form layouts.

## Implementation

The palette is implemented in the trade, landing, and account access pages through `apps/frontend/src/apex-reference-theme.css`. Live and illustrative trade charts use the selected market's asset color; buy and sell retain semantic green and red.
