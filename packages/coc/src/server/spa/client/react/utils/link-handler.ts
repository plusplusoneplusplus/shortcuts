/**
 * Generic configurable link handler registry.
 *
 * Provides a declarative list of named handlers that intercept specific URLs
 * and open them in their respective desktop applications instead of a browser tab.
 *
 * All handlers are **enabled by default**. The consumer passes the per-user
 * config (from `useLinkHandlers`) as a parameter so this module stays pure
 * and testable with no side effects at import time.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LinkHandler {
    /** Unique, stable handler name used as the config key. */
    name: string;
    /** Returns true when this handler should process the given href. */
    matches: (href: string) => boolean;
    /** Opens the href using the appropriate mechanism. */
    open: (href: string) => void;
}

export interface LinkHandlerMeta {
    name: string;
    label: string;
    description: string;
}

// ── Built-in handlers ─────────────────────────────────────────────────────────

/** Rewrite a Teams web URL to the msteams:// protocol scheme. */
function teamsOpen(href: string): void {
    // Strip the leading "https:" so the host+path can be prefixed with msteams://
    const protocolUrl = href.replace(/^https:\/\//i, 'msteams://');
    window.location.href = protocolUrl;
}

const teamsHandler: LinkHandler = {
    name: 'teams',
    matches: (href) => /^https:\/\/teams\.microsoft\.com\//i.test(href),
    open: teamsOpen,
};

const vscodeHandler: LinkHandler = {
    name: 'vscode',
    matches: (href) => /^vscode(-insiders)?:\/\//i.test(href),
    open: (href) => { window.location.href = href; },
};

const fileHandler: LinkHandler = {
    name: 'file',
    matches: (href) => /^file:\/\//i.test(href),
    open: (href) => { window.location.href = href; },
};

/** OneNote links can arrive as:
 *  - https://onedrive.live.com/redir?...onenote...
 *  - onenote:https://...
 */
function onenoteMatches(href: string): boolean {
    return (
        /^onenote:/i.test(href) ||
        (/^https:\/\/onedrive\.live\.com\/redir/i.test(href) && /onenote/i.test(href))
    );
}

function onenoteOpen(href: string): void {
    if (/^https:\/\//i.test(href)) {
        // Convert the OneDrive redirect URL to onenote: scheme by stripping https:
        window.location.href = 'onenote:' + href;
    } else {
        window.location.href = href;
    }
}

const onenoteHandler: LinkHandler = {
    name: 'onenote',
    matches: onenoteMatches,
    open: onenoteOpen,
};

// ── Registry ──────────────────────────────────────────────────────────────────

/** Ordered list of all built-in link handlers. */
export const BUILTIN_LINK_HANDLERS: LinkHandler[] = [
    teamsHandler,
    vscodeHandler,
    fileHandler,
    onenoteHandler,
];

/** Display metadata for the settings UI. */
export const LINK_HANDLER_META: LinkHandlerMeta[] = [
    {
        name: 'teams',
        label: 'Microsoft Teams',
        description: 'Open teams.microsoft.com links in the Teams desktop app.',
    },
    {
        name: 'vscode',
        label: 'Code Editor',
        description: 'Open vscode:// and vscode-insiders:// links with the registered desktop handler.',
    },
    {
        name: 'file',
        label: 'Local Files',
        description: 'Open file:// links in the native file manager or OS handler.',
    },
    {
        name: 'onenote',
        label: 'OneNote',
        description: 'Open OneNote and OneDrive/OneNote redirect links in the OneNote desktop app.',
    },
];

export const DEFAULT_LINK_HANDLERS_CONFIG: Record<string, boolean> =
    Object.fromEntries(LINK_HANDLER_META.map(meta => [meta.name, true]));

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Open `href` using the first enabled handler that matches, or fall back to
 * `window.open(href, '_blank', 'noopener')` when no handler matches/is enabled.
 *
 * @param href   The URL to open.
 * @param config A map of handler name → enabled flag (from `useLinkHandlers`).
 *               Missing built-in handler keys are treated as enabled.
 */
export function openLink(href: string, config: Record<string, boolean>): void {
    for (const handler of BUILTIN_LINK_HANDLERS) {
        if (config[handler.name] !== false && handler.matches(href)) {
            handler.open(href);
            return;
        }
    }
    window.open(href, '_blank', 'noopener');
}

/**
 * Returns display metadata for all built-in handlers, useful for rendering
 * the settings UI without importing the full handler objects.
 */
export function getLinkHandlersMeta(): LinkHandlerMeta[] {
    return LINK_HANDLER_META;
}
