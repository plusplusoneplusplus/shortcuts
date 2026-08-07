/**
 * Tailwind config for the vendored canvas utility stylesheet
 * (`dist/canvas-vendor/tailwind.css`).
 *
 * Extension canvases are authored by the AI at runtime, so there is no source
 * tree for Tailwind's JIT to scan — `content` is empty on purpose and the whole
 * stylesheet comes from an explicit safelist. That makes the covered utility set
 * a *contract*: a class outside this list silently does nothing in an artifact,
 * which is why the `extension_canvas` tool description spells the subset out.
 *
 * The Play CDN is deliberately NOT an option: it is a runtime JIT compiler that
 * must be fetched from a CDN, which breaks air-gapped installs and the offline
 * HTML export.
 *
 * Size is the whole design tension here — the stylesheet is inlined into every
 * React artifact export. Keep additions cheap: a new colour-taking utility
 * prefix multiplies by the palette (18 hues x 10 shades), a new variant
 * multiplies by everything it is applied to.
 */

/**
 * Spacing steps used by padding/margin/gap/size utilities. Deliberately not the
 * full Tailwind scale — every step multiplies across ~14 utility prefixes and
 * every responsive variant.
 */
const SPACE = '0|px|0\\.5|1|1\\.5|2|2\\.5|3|3\\.5|4|5|6|8|10|12|16|20|24|32|40|48|64';

/**
 * Palette hues exposed to artifacts. Charts need variety, but colour is the
 * single largest contributor to stylesheet size (prefixes x hues x shades x
 * variants), so the near-duplicate greys (neutral, stone) and the two hues that
 * sit between neighbours (lime, fuchsia) are left out.
 */
const HUES =
    'slate|gray|zinc|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|pink|rose';
const SHADE = '50|100|200|300|400|500|600|700|800|900';
const COLOR = `(?:inherit|current|transparent|black|white|(?:${HUES})-(?:${SHADE}))`;

/**
 * The one responsive breakpoint artifacts get. `md:` covers the "stack on
 * narrow, columns on wide" case that dashboards actually need; adding `sm:` and
 * `lg:` tripled the layout half of the sheet for very little.
 */
const RESPONSIVE = ['md'];

/** Fractions accepted by width/height utilities. */
const FRACTION = '1\\/2|1\\/3|2\\/3|1\\/4|2\\/4|3\\/4|1\\/5|2\\/5|3\\/5|4\\/5|1\\/6|5\\/6|1\\/12|full|screen|auto|min|max|fit';

/** @type {import('tailwindcss').Config} */
export default {
    content: [],
    darkMode: 'class',
    safelist: [
        // ---- display / layout -------------------------------------------
        {
            pattern:
                /^(block|inline-block|inline|flex|inline-flex|grid|inline-grid|contents|hidden|table|table-row|table-cell|flow-root)$/,
            variants: RESPONSIVE,
        },
        { pattern: /^(static|relative|absolute|fixed|sticky)$/ },
        { pattern: new RegExp(`^(inset|inset-x|inset-y|top|right|bottom|left)-(${SPACE}|auto|full)$`) },
        { pattern: /^z-(0|10|20|30|40|50|auto)$/ },
        { pattern: /^(box-border|box-content|isolate|float-left|float-right|float-none|clear-both)$/ },

        // ---- flex / grid ------------------------------------------------
        { pattern: /^flex-(row|row-reverse|col|col-reverse|wrap|wrap-reverse|nowrap|1|auto|initial|none)$/, variants: RESPONSIVE },
        { pattern: /^(grow|grow-0|shrink|shrink-0|order-(first|last|none|[1-9]|1[0-2]))$/ },
        { pattern: /^items-(start|end|center|baseline|stretch)$/ },
        { pattern: /^justify-(start|end|center|between|around|evenly|stretch)$/ },
        { pattern: /^(content|self|place-items|place-content)-(start|end|center|between|around|evenly|stretch|baseline|auto)$/ },
        { pattern: /^grid-(cols|rows)-(none|[1-9]|1[0-2])$/, variants: RESPONSIVE },
        { pattern: /^(col|row)-span-(full|[1-9]|1[0-2])$/, variants: RESPONSIVE },
        { pattern: /^(col|row)-start-(auto|[1-9]|1[0-3])$/ },
        { pattern: /^grid-flow-(row|col|dense|row-dense|col-dense)$/ },
        { pattern: new RegExp(`^(gap|gap-x|gap-y)-(${SPACE})$`), variants: RESPONSIVE },
        { pattern: new RegExp(`^(space-x|space-y)-(${SPACE})$`) },

        // ---- spacing ----------------------------------------------------
        { pattern: new RegExp(`^(p|px|py|pt|pr|pb|pl)-(${SPACE})$`), variants: RESPONSIVE },
        { pattern: new RegExp(`^-?(m|mx|my|mt|mr|mb|ml)-(${SPACE}|auto)$`), variants: RESPONSIVE },

        // ---- sizing -----------------------------------------------------
        { pattern: new RegExp(`^(w|h)-(${SPACE}|${FRACTION})$`), variants: RESPONSIVE },
        { pattern: new RegExp(`^(min-w|min-h)-(0|full|screen|min|max|fit)$`) },
        { pattern: /^max-w-(none|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|full|min|max|fit|prose|screen-sm|screen-md|screen-lg)$/ },
        { pattern: /^max-h-(none|full|screen|min|max|fit)$/ },
        { pattern: /^aspect-(auto|square|video)$/ },

        // ---- typography --------------------------------------------------
        { pattern: /^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)$/, variants: RESPONSIVE },
        { pattern: /^font-(sans|serif|mono|thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/ },
        { pattern: /^(italic|not-italic|underline|overline|line-through|no-underline|uppercase|lowercase|capitalize|normal-case|truncate|antialiased|tabular-nums)$/ },
        { pattern: /^text-(left|center|right|justify|start|end)$/ },
        { pattern: /^(leading|tracking)-(none|tight|snug|normal|relaxed|loose|wide|wider|widest|tighter|3|4|5|6|7|8|9|10)$/ },
        { pattern: /^whitespace-(normal|nowrap|pre|pre-line|pre-wrap|break-spaces)$/ },
        { pattern: /^(break-normal|break-words|break-all|break-keep)$/ },
        { pattern: /^align-(baseline|top|middle|bottom|text-top|text-bottom)$/ },
        { pattern: /^list-(none|disc|decimal|inside|outside)$/ },
        { pattern: /^line-clamp-([1-6]|none)$/ },

        // ---- colour ------------------------------------------------------
        // Colour is ~55% of the stylesheet, so the palette is only paired with
        // the prefixes that need it. `fill`/`stroke` get the keywords only —
        // Recharts takes colours as literal props (`fill="#3b82f6"`), and inline
        // SVG icons want `fill-current`, so the full palette there is dead weight.
        // `hover:` is likewise limited to the two prefixes artifacts hover-style.
        { pattern: new RegExp(`^(text|bg|border|ring|divide)-${COLOR}$`) },
        { pattern: new RegExp(`^(text|bg)-${COLOR}$`), variants: ['hover'] },
        { pattern: /^(fill|stroke)-(inherit|current|transparent|black|white|none)$/ },
        { pattern: /^(bg|from|via|to)-(gradient-to-[trbl]{1,2})$/ },
        { pattern: /^bg-(none|cover|contain|center|no-repeat|repeat)$/ },
        { pattern: /^(opacity|bg-opacity|text-opacity|border-opacity)-(0|5|10|20|25|30|40|50|60|70|75|80|90|95|100)$/, variants: ['hover'] },

        // ---- borders / radius / effects ----------------------------------
        { pattern: /^border(-[trblxy])?(-(0|2|4|8))?$/ },
        { pattern: /^(divide-x|divide-y)(-(0|2|4|8|reverse))?$/ },
        { pattern: /^border-(solid|dashed|dotted|double|none|collapse|separate)$/ },
        { pattern: /^rounded(-(none|sm|md|lg|xl|2xl|3xl|full))?$/ },
        { pattern: /^rounded-([trbl]|tl|tr|br|bl)(-(none|sm|md|lg|xl|2xl|3xl|full))?$/ },
        { pattern: /^shadow(-(sm|md|lg|xl|2xl|inner|none))?$/, variants: ['hover'] },
        { pattern: /^ring(-(0|1|2|4|8|inset))?$/, variants: ['focus'] },
        { pattern: /^ring-offset-(0|1|2|4|8)$/ },

        // ---- overflow / interaction / motion -----------------------------
        { pattern: /^overflow(-[xy])?-(auto|hidden|clip|visible|scroll)$/ },
        { pattern: /^object-(contain|cover|fill|none|scale-down|center|top|bottom|left|right)$/ },
        { pattern: /^cursor-(auto|default|pointer|wait|text|move|help|not-allowed|grab|grabbing)$/ },
        { pattern: /^(select-none|select-text|select-all|select-auto|pointer-events-none|pointer-events-auto|appearance-none|resize|resize-none|resize-x|resize-y|sr-only|not-sr-only)$/ },
        { pattern: /^(transition|transition-(none|all|colors|opacity|shadow|transform))$/ },
        { pattern: /^(duration|delay)-(75|100|150|200|300|500|700|1000)$/ },
        { pattern: /^ease-(linear|in|out|in-out)$/ },
        { pattern: /^animate-(none|spin|ping|pulse|bounce)$/ },
        { pattern: /^(scale|rotate|translate-x|translate-y)-(0|1|2|3|6|12|45|50|75|90|95|100|105|110|125|150|180)$/, variants: ['hover'] },
        { pattern: /^(table-auto|table-fixed|caption-top|caption-bottom)$/ },
    ],
    theme: {
        extend: {
            screens: {
                sm: '640px',
                md: '768px',
                lg: '1024px',
            },
        },
    },
    plugins: [],
};
