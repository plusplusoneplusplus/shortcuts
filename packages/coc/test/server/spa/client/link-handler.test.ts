/**
 * Tests for utils/link-handler.ts
 *
 * Covers:
 * - Built-in handler match predicates
 * - openLink() routing (handler wins / fallback)
 * - getLinkHandlersMeta() returns all built-in metadata
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    BUILTIN_LINK_HANDLERS,
    openLink,
    getLinkHandlersMeta,
} from '../../../../src/server/spa/client/react/utils/link-handler';

// ── Handler predicates ─────────────────────────────────────────────────────

describe('teams handler', () => {
    const handler = BUILTIN_LINK_HANDLERS.find(h => h.name === 'teams')!;

    it('matches teams.microsoft.com https URLs', () => {
        expect(handler.matches('https://teams.microsoft.com/l/channel/...')).toBe(true);
        expect(handler.matches('https://teams.microsoft.com/')).toBe(true);
        expect(handler.matches('HTTPS://TEAMS.MICROSOFT.COM/foo')).toBe(true);
    });

    it('does not match other HTTPS URLs', () => {
        expect(handler.matches('https://outlook.microsoft.com/mail')).toBe(false);
        expect(handler.matches('https://github.com')).toBe(false);
    });

    it('does not match msteams:// URLs (already protocol-scheme)', () => {
        expect(handler.matches('msteams://teams.microsoft.com/foo')).toBe(false);
    });
});

describe('vscode handler', () => {
    const handler = BUILTIN_LINK_HANDLERS.find(h => h.name === 'vscode')!;

    it('matches vscode:// URLs', () => {
        expect(handler.matches('vscode://ms-vscode.cpptools/...')).toBe(true);
        expect(handler.matches('VSCODE://some-ext')).toBe(true);
    });

    it('matches vscode-insiders:// URLs', () => {
        expect(handler.matches('vscode-insiders://ms-vscode.cpptools/...')).toBe(true);
    });

    it('does not match non-vscode URLs', () => {
        expect(handler.matches('https://code.visualstudio.com')).toBe(false);
        expect(handler.matches('https://teams.microsoft.com')).toBe(false);
    });
});

describe('onenote handler', () => {
    const handler = BUILTIN_LINK_HANDLERS.find(h => h.name === 'onenote')!;

    it('matches onenote: protocol scheme', () => {
        expect(handler.matches('onenote:https://d.docs.live.net/...')).toBe(true);
        expect(handler.matches('ONENOTE:https://...')).toBe(true);
    });

    it('matches OneDrive redirect URLs containing onenote', () => {
        expect(handler.matches('https://onedrive.live.com/redir?resid=...&onenote')).toBe(true);
        expect(handler.matches('https://onedrive.live.com/redir?page=onenote&...')).toBe(true);
    });

    it('does not match plain OneDrive URLs without onenote', () => {
        expect(handler.matches('https://onedrive.live.com/redir?resid=abc')).toBe(false);
    });

    it('does not match unrelated HTTPS URLs', () => {
        expect(handler.matches('https://teams.microsoft.com')).toBe(false);
    });
});

// ── openLink() ─────────────────────────────────────────────────────────────

describe('openLink', () => {
    let mockWindowOpen: ReturnType<typeof vi.fn>;
    let mockLocationHref: string;

    beforeEach(() => {
        mockWindowOpen = vi.fn();
        mockLocationHref = '';
        vi.stubGlobal('window', {
            open: mockWindowOpen,
            location: {
                get href() { return mockLocationHref; },
                set href(v: string) { mockLocationHref = v; },
            },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('falls back to window.open when no handlers are enabled', () => {
        openLink('https://github.com', {});
        expect(mockWindowOpen).toHaveBeenCalledWith('https://github.com', '_blank', 'noopener');
    });

    it('falls back to window.open when a handler is disabled (false)', () => {
        openLink('https://teams.microsoft.com/l/channel/abc', { teams: false });
        expect(mockWindowOpen).toHaveBeenCalledWith(
            'https://teams.microsoft.com/l/channel/abc', '_blank', 'noopener'
        );
    });

    it('opens teams URL via msteams:// when teams handler is enabled', () => {
        openLink('https://teams.microsoft.com/l/channel/abc', { teams: true });
        expect(mockWindowOpen).not.toHaveBeenCalled();
        expect(mockLocationHref).toBe('msteams://teams.microsoft.com/l/channel/abc');
    });

    it('opens vscode URL via location.href when vscode handler is enabled', () => {
        openLink('vscode://ms-vscode.cpptools/open', { vscode: true });
        expect(mockWindowOpen).not.toHaveBeenCalled();
        expect(mockLocationHref).toBe('vscode://ms-vscode.cpptools/open');
    });

    it('opens onenote: scheme URLs via location.href when onenote handler is enabled', () => {
        openLink('onenote:https://d.docs.live.net/nb/page', { onenote: true });
        expect(mockWindowOpen).not.toHaveBeenCalled();
        expect(mockLocationHref).toBe('onenote:https://d.docs.live.net/nb/page');
    });

    it('converts OneDrive onenote redirect to onenote: scheme when onenote handler is enabled', () => {
        openLink('https://onedrive.live.com/redir?resid=x&onenote', { onenote: true });
        expect(mockLocationHref).toBe('onenote:https://onedrive.live.com/redir?resid=x&onenote');
    });

    it('only calls window.open once (first matching handler wins)', () => {
        // GitHub URL matches no built-in handler — falls back
        openLink('https://github.com/org/repo', { teams: true, vscode: true, onenote: true });
        expect(mockWindowOpen).toHaveBeenCalledOnce();
    });

    it('falls back for mailto: links', () => {
        openLink('mailto:user@example.com', {});
        expect(mockWindowOpen).toHaveBeenCalledWith('mailto:user@example.com', '_blank', 'noopener');
    });
});

// ── getLinkHandlersMeta() ──────────────────────────────────────────────────

describe('getLinkHandlersMeta', () => {
    it('returns metadata for all three built-in handlers', () => {
        const meta = getLinkHandlersMeta();
        const names = meta.map(m => m.name);
        expect(names).toContain('teams');
        expect(names).toContain('vscode');
        expect(names).toContain('onenote');
    });

    it('each entry has name, label, and description', () => {
        const meta = getLinkHandlersMeta();
        for (const m of meta) {
            expect(typeof m.name).toBe('string');
            expect(m.name.length).toBeGreaterThan(0);
            expect(typeof m.label).toBe('string');
            expect(m.label.length).toBeGreaterThan(0);
            expect(typeof m.description).toBe('string');
            expect(m.description.length).toBeGreaterThan(0);
        }
    });
});
