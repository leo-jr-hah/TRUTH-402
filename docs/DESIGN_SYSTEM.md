# TRUTH-402 design system v3

TRUTH-402 adds a track-record view to prediction markets. The crowd price says what the market believes. The track-record view re-weights that by each trader's history. The simulated market inside the app demonstrates it.

Audience: someone who already uses Polymarket. They know Yes/No prices in cents, market cards, a trade ticket, volume. Keep those familiar patterns, and make ONE new idea unmistakable: every market has two numbers, **Crowd** and **Track record**.

## Look: calm, light, precise (think Stripe or Apple, not a crypto dashboard)

Palette is one real Color Hunt palette, used verbatim: fog `#EEEEEE`, ice `#B9E4E8`, teal `#167D8D`, navy `#071B2B`. Nothing else, no other hex, no green, no red, no white, no purple, no gradients.

Semantic Tailwind tokens (follow the active theme): `bg-ground text-ink bg-panel bg-panel-2 border-line border-line-strong text-teal bg-teal text-accent bg-navy text-fog bg-ice`. Opacity modifiers allowed (`text-ink/70`, never below `/55` for readable text). Themes via `data-theme="light"` (default), `"dark"` (navy ground), `"ice"` (ice ground). A dark navy block inside a light page is a strong accent, use sparingly.

- Crowd = ink (neutral). Track record = teal. That is the only color coding. Never use color to mean good or bad: show direction with arrows and signs (+4 pp, -3 pp). No green, no red, ever.
- Buttons: `.button-primary` is navy on light (ink on ground). `.button-secondary` is outlined. No colored buttons per meaning.
- Surfaces: `.card` hairline border, soft shadow, 20px radius. No hard offset shadows, no glow, no glass, no gradient text, no neon.

## Words

Few. A heading plus at most one short line (under 14 words). Labels over sentences. Plain language: say "Crowd" and "Track record", never "memory-calibrated", "shrinkage", "oracle", "alpha", "T-score" in primary UI (technical terms may appear only inside a collapsed "Details" disclosure). Explain by showing, not by paragraphs. No eyebrow labels above headings. No numbered markers. No em dash characters anywhere (a test enforces it).

## Type

Hanken Grotesk for everything (`font-display` and `font-sans` are the same family). Headings weight 650-700, tracking -0.035em, tight leading. Numbers `.num` (tabular). JetBrains Mono (`font-mono`) only for ids, hashes, code.

## Motion

`motion/react`. Easing `cubic-bezier(0.16,1,0.3,1)`; spring for press. Numbers tween (`CountUp`), bars grow in, lists reorder with `layout`, dropdowns animate (`Select`, `Disclosure`, never native), icons have purposeful micro-motion, buttons press. Calm and fast, not bouncy-cartoon. Honor reduced motion.

## Primitives

`src/components/ui/`: `Select`, `Disclosure`, `CountUp`, `Reveal`, `Tooltip`, `burst(el, tone)` (tone `"sun"|"tomato"|"plum"|"night"` or legacy names; colors are palette-mapped, leave as is). Classes in `globals.css`: `.card .card-interactive .card-flat .sticker .button-* .field .textarea .field-label .field-error .skeleton .rise .live-dot .marquee .num .muted .display`.

Legacy aliases still resolve (`abyss ivory lime coral raise raise-2 sun tomato plum night`) but remove them from any file you rewrite and use the semantic tokens above. NOTE: `lime` now means teal, `coral` now means muted ink, `ivory` means ink, `abyss` means ground. On-color text for `bg-teal` is `text-white`... use `text-fog`.

## Layout

Shell supplies max-w 1320 and the nav. Pages: a heading, then the thing. Keep screens uncluttered, generous whitespace, 360px to 1440px, no horizontal overflow, 44px touch targets, every state designed (hover, focus-visible, active, disabled, loading, empty, error).
