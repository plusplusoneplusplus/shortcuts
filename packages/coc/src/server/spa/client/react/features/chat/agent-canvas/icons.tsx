// Line-icon set for the Agents canvas — agent roles, spawn, and view nav.
// Ported from the coc-chat design (chat-icons.jsx) so glyphs match the mock.

import type { ReactNode, SVGProps } from 'react';

export interface AcIconProps extends Omit<SVGProps<SVGSVGElement>, 'stroke'> {
    size?: number;
    /** Stroke width (the icons are stroked, not filled). */
    stroke?: number;
}

function mk(paths: ReactNode, viewBox = '0 0 16 16') {
    return function Icon({ size = 16, stroke = 1.5, ...rest }: AcIconProps) {
        return (
            <svg
                width={size}
                height={size}
                viewBox={viewBox}
                fill="none"
                stroke="currentColor"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                {...rest}
            >
                {paths}
            </svg>
        );
    };
}

export const AcIcons = {
    // ── roles ──
    Orchestr: mk(<><circle cx="8" cy="8" r="2" /><circle cx="8" cy="2.6" r="1.3" /><circle cx="3" cy="11.5" r="1.3" /><circle cx="13" cy="11.5" r="1.3" /><path d="M8 6V4M6.6 9.1l-2.3 1.5M9.4 9.1l2.3 1.5" /></>),
    Explorer: mk(<><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L14 14" /></>),
    Refactor: mk(<><path d="M3 6V4.5A1.5 1.5 0 014.5 3H6M3 10v1.5A1.5 1.5 0 004.5 13H6M13 6V4.5A1.5 1.5 0 0011.5 3H10M13 10v1.5a1.5 1.5 0 01-1.5 1.5H10" /><path d="M6 8h4" /></>),
    Tester: mk(<><path d="M6 2h4M6.5 2v4L4 11.5a1.2 1.2 0 001.1 1.7h5.8A1.2 1.2 0 0012 11.5L9.5 6V2" /><path d="M5.4 9h5.2" /></>),
    Reviewer: mk(<><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></>),
    Planner: mk(<><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5 6l1.2 1.2L8 5.5M5 10l1.2 1.2L8 9.5M10 6.2h1.5M10 10.2h1.5" /></>),
    Doc: mk(<><path d="M4 2.5h5l3 3v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3.5a1 1 0 011-1z" /><path d="M9 2.5V6h3.5" /></>),
    Agent: mk(<><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 13a4.5 4.5 0 019 0" /></>),

    // ── canvas controls / nav ──
    Spawn: mk(<><circle cx="4" cy="4" r="1.5" /><circle cx="4" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><path d="M4 5.5v3a2 2 0 002 2h4.2M4 9.4h.01" /><path d="M10 10.5l2 1.5" /></>),
    Expand: mk(<><path d="M9.5 2.5H13.5V6.5M6.5 13.5H2.5V9.5M13.5 2.5l-4.5 4.5M2.5 13.5l4.5-4.5" /></>),
    Collapse: mk(<><path d="M13 3l-3.5 3.5M9.5 6.5V3M9.5 6.5H13M3 13l3.5-3.5M6.5 9.5V13M6.5 9.5H3" /></>),
    Replay: mk(<><path d="M3 8a5 5 0 105-5 5 5 0 00-3.6 1.5L3 5" /><path d="M3 2.5V5h2.5" /></>),
    Thread: mk(<><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h7" /></>),
    Tree: mk(<><rect x="2" y="6" width="4" height="4" rx="1" /><rect x="10.5" y="2.5" width="3.5" height="3.5" rx="1" /><rect x="10.5" y="10" width="3.5" height="3.5" rx="1" /><path d="M6 8h2.2M8.2 8V4.2h2.3M8.2 8v3.8h2.3" /></>),
};

// Keyword → role glyph, matched in order. Real sub-agent types are free-form
// strings (e.g. 'Explore', 'general-purpose', 'rust-code-reviewer'), so we map
// by substring rather than an exact enum.
const ROLE_ICON_RULES: Array<[string[], (p: AcIconProps) => ReactNode]> = [
    [['orchestr'], AcIcons.Orchestr],
    [['explor', 'research', 'search'], AcIcons.Explorer],
    [['review'], AcIcons.Reviewer],
    [['test'], AcIcons.Tester],
    [['plan'], AcIcons.Planner],
    [['refactor', 'fix', 'impl', 'edit', 'code'], AcIcons.Refactor],
    [['doc', 'write'], AcIcons.Doc],
];

/** Pick a role glyph by keyword, falling back to a generic agent icon. */
export function roleIcon(role: string | undefined): (p: AcIconProps) => ReactNode {
    const r = (role || '').toLowerCase();
    for (const [keywords, icon] of ROLE_ICON_RULES) {
        if (keywords.some((k) => r.includes(k))) {
            return icon;
        }
    }
    return AcIcons.Agent;
}
