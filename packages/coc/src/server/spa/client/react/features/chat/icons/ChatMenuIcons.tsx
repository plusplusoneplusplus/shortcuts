/**
 * ChatMenuIcons — 16px stroke glyphs for the chat header overflow menu.
 *
 * One consistent line style (`currentColor`, 1.5 stroke) replaces the mix of
 * text abbreviations and color emoji the menu used to carry, so the rows align
 * and follow the menu's light/dark text color.
 */
import type { ReactNode } from 'react';

function Glyph({ children }: { children: ReactNode }) {
    return (
        <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {children}
        </svg>
    );
}

export const PinIcon = () => (
    <Glyph>
        <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6 6 2z" />
        <path d="M8 8.5V14" />
    </Glyph>
);

export const UnpinIcon = () => (
    <Glyph>
        <path d="M6 2h4l-.5 4 2.5 2.5H4L6.5 6 6 2z" />
        <path d="M8 8.5V14" />
        <path d="M2.5 2.5l11 11" />
    </Glyph>
);

export const CodeIcon = () => (
    <Glyph>
        <path d="M5.5 4.5L2 8l3.5 3.5" />
        <path d="M10.5 4.5L14 8l-3.5 3.5" />
    </Glyph>
);

export const SelectIcon = () => (
    <Glyph>
        <rect x="2" y="2.5" width="4" height="4" rx="0.75" />
        <path d="M2.9 4.6l.9.9 1.5-1.6" />
        <rect x="2" y="9.5" width="4" height="4" rx="0.75" />
        <path d="M8.5 4.5H14M8.5 11.5H14" />
    </Glyph>
);

export const ExportIcon = () => (
    <Glyph>
        <path d="M9 2H4.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.5L9 2z" />
        <path d="M9 2v3.5h3.5" />
        <path d="M8 7.5v4M6.25 9.75L8 11.5l1.75-1.75" />
    </Glyph>
);

export const TerminalIcon = () => (
    <Glyph>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
        <path d="M4.5 6l2 2-2 2M8.5 10.5h3" />
    </Glyph>
);

export const CopyIcon = () => (
    <Glyph>
        <rect x="5.5" y="5.5" width="8" height="8.5" rx="1" />
        <path d="M10.5 5.5V3a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
    </Glyph>
);

export const NoteIcon = () => (
    <Glyph>
        <path d="M3 4h10M3 8h10M3 12h6" />
    </Glyph>
);

export const ForkIcon = () => (
    <Glyph>
        <circle cx="4.5" cy="3.5" r="1.5" />
        <circle cx="11.5" cy="3.5" r="1.5" />
        <circle cx="8" cy="12.5" r="1.5" />
        <path d="M4.5 5v1a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V5M8 8v3" />
    </Glyph>
);

export const NewChatIcon = () => (
    <Glyph>
        <path d="M13.5 9.5a1 1 0 0 1-1 1H6l-3.5 3V3.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6z" />
        <path d="M8 4.5v4M6 6.5h4" />
    </Glyph>
);

export const ReferencesIcon = () => (
    <Glyph>
        <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5l-.75.75" />
        <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.75-.75" />
    </Glyph>
);

export const FloatIcon = () => (
    <Glyph>
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <path d="M2 6h12" />
    </Glyph>
);

export const PopOutIcon = () => (
    <Glyph>
        <path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" />
        <path d="M10 2h4v4M14 2L8 8" />
    </Glyph>
);
