/**
 * PopOutDevToolsShell — route matching, pop-out URL and the standalone render.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ preferences: { patchGlobal: vi.fn().mockResolvedValue({}) } }),
}));

import {
    PopOutDevToolsShell,
    isPopOutDevToolsRoute,
    devToolsPopOutUrl,
    DEV_TOOLS_POPOUT_WINDOW_NAME,
} from '../../../../src/server/spa/client/react/layout/PopOutDevToolsShell';
import { DEV_TOOLS } from '../../../../src/server/spa/client/react/features/dev-tools/registry';

describe('isPopOutDevToolsRoute', () => {
    it('matches the dev-tools hash with or without the leading #', () => {
        expect(isPopOutDevToolsRoute('#popout/dev-tools')).toBe(true);
        expect(isPopOutDevToolsRoute('popout/dev-tools')).toBe(true);
    });

    it('ignores other routes', () => {
        expect(isPopOutDevToolsRoute('')).toBe(false);
        expect(isPopOutDevToolsRoute('#popout/canvas')).toBe(false);
        expect(isPopOutDevToolsRoute('#admin')).toBe(false);
        expect(isPopOutDevToolsRoute('#dev-tools')).toBe(false);
    });
});

describe('devToolsPopOutUrl', () => {
    it('builds an absolute same-origin URL carrying the dev-tools hash', () => {
        const url = devToolsPopOutUrl();
        expect(url.startsWith(window.location.origin)).toBe(true);
        expect(url.endsWith('#popout/dev-tools')).toBe(true);
        // No query string is needed — the tools are pure client-side widgets.
        expect(url).not.toContain('?');
    });

    it('exposes a stable window name so re-popping focuses the same window', () => {
        expect(DEV_TOOLS_POPOUT_WINDOW_NAME).toBe('coc-dev-tools');
    });
});

describe('PopOutDevToolsShell', () => {
    beforeEach(() => {
        document.title = '';
        // jsdom ships no matchMedia; ThemeProvider resolves 'auto' through it.
        vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
            matches: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        }));
    });

    it('renders every tool card standalone and titles the window', () => {
        render(<PopOutDevToolsShell />);
        expect(screen.getByTestId('popout-dev-tools-shell')).toBeTruthy();
        expect(screen.getByTestId('dev-tools-panel')).toBeTruthy();
        for (const tool of DEV_TOOLS) {
            expect(screen.getByTestId(`dev-tool-card-${tool.id}`)).toBeTruthy();
        }
        expect(document.title.startsWith('Dev Tools —')).toBe(true);
    });

    it('renders no dialog overlay — it owns the whole window', () => {
        render(<PopOutDevToolsShell />);
        expect(screen.queryByTestId('dialog-overlay')).toBeNull();
    });
});
