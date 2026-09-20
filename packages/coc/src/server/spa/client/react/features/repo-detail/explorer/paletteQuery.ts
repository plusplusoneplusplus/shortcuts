/**
 * The palette's query grammar — one dialog, several modes, no extra dialogs.
 *
 * Visual Studio's Go To All is a single box whose leading characters say what
 * you are looking for: `t ` for a type, `m ` for a member, `f ` for a file,
 * `:120` for a line. CoC's palette copies that, which means `Ctrl+P` and
 * `Ctrl+,` are the same component opened on a different default and the user
 * can cross between them without closing anything.
 *
 * The one rule worth stating: a prefix needs its trailing space. `f` on its own
 * is a search for something called `f`, and there are plenty of those; `f ` is
 * the file filter. Backspacing the space therefore restores the mode the dialog
 * was opened in, which is why the default is a parameter rather than a constant.
 *
 * Pure on purpose — the dialog is awkward to drive in a test, and the grammar
 * is the part with edge cases.
 */

export type PaletteMode = 'files' | 'symbols';

/** Which `SymbolKind`s survive the active prefix filter. */
export type SymbolKindFilter = 'types' | 'members';

export interface ParsedPaletteQuery {
    mode: PaletteMode;
    kindFilter?: SymbolKindFilter;
    /** One-based line the user asked to jump to, from a `:N` query. */
    lineTarget?: number;
    /** What to actually search for, with the prefix removed. */
    term: string;
    /** Footer text naming the active filter, so the mode is never invisible. */
    filterLabel?: string;
}

/** LSP `SymbolKind`s the `t ` filter keeps: the type-like declarations. */
const TYPE_KINDS = new Set([
    5, // Class
    10, // Enum
    11, // Interface
    23, // Struct
]);

/** LSP `SymbolKind`s the `m ` filter keeps: the things that live inside one. */
const MEMBER_KINDS = new Set([
    6, // Method
    7, // Property
    8, // Field
    9, // Constructor
    12, // Function
]);

/**
 * Split a raw palette query into what to search and how.
 *
 * `defaultMode` is the mode the dialog was opened in — `files` for `Ctrl+P`,
 * `symbols` for `Ctrl+,` — and is what an unprefixed query falls back to.
 */
export function parsePaletteQuery(raw: string, defaultMode: PaletteMode): ParsedPaletteQuery {
    const line = /^:(\d+)\s*$/.exec(raw.trim());
    if (line) {
        return {
            mode: defaultMode,
            term: '',
            lineTarget: Number(line[1]),
            filterLabel: `Go to line ${Number(line[1])}`,
        };
    }

    const prefix = /^([tmf]) (.*)$/s.exec(raw);
    if (!prefix) {
        return { mode: defaultMode, term: raw.trim() };
    }
    const term = prefix[2].trim();
    switch (prefix[1]) {
        case 'f':
            return { mode: 'files', term, filterLabel: 'Files' };
        case 't':
            return { mode: 'symbols', kindFilter: 'types', term, filterLabel: 'Types' };
        default:
            return { mode: 'symbols', kindFilter: 'members', term, filterLabel: 'Members' };
    }
}

/** Whether a symbol survives the active kind filter. No filter keeps everything. */
export function matchesKindFilter(kind: number, filter: SymbolKindFilter | undefined): boolean {
    if (!filter) return true;
    return (filter === 'types' ? TYPE_KINDS : MEMBER_KINDS).has(kind);
}
