/**
 * Tests for PopOutActivityShell (source-level verification).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const LAYOUT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'layout'
);
const SOURCE = fs.readFileSync(path.join(LAYOUT_DIR, 'PopOutActivityShell.tsx'), 'utf-8');

describe('PopOutActivityShell: structure', () => {
    it('exports PopOutActivityShell component', () => {
        expect(SOURCE).toContain('export function PopOutActivityShell');
    });

    it('exports parsePopOutActivityRoute helper', () => {
        expect(SOURCE).toContain('export function parsePopOutActivityRoute');
    });

    it('exports PopOutRouteParams type', () => {
        expect(SOURCE).toContain('export interface PopOutRouteParams');
    });
});

describe('PopOutActivityShell: providers', () => {
    it('wraps with AppProvider', () => {
        expect(SOURCE).toContain('<AppProvider>');
    });

    it('wraps with QueueProvider', () => {
        expect(SOURCE).toContain('<QueueProvider>');
    });

    it('wraps with ThemeProvider', () => {
        expect(SOURCE).toContain('<ThemeProvider>');
    });

    it('wraps with ToastProvider', () => {
        expect(SOURCE).toContain('<ToastProvider');
    });
});

describe('PopOutActivityShell: ActivityChatDetail usage', () => {
    it('renders ActivityChatDetail', () => {
        expect(SOURCE).toContain('<ActivityChatDetail');
    });

    it('passes isPopOut={true} to ActivityChatDetail', () => {
        expect(SOURCE).toContain('isPopOut={true}');
    });

    it('passes workspaceId to ActivityChatDetail', () => {
        expect(SOURCE).toContain('workspaceId=');
    });
});

describe('PopOutActivityShell: BroadcastChannel communication', () => {
    it('uses usePopOutChannel hook', () => {
        expect(SOURCE).toContain('usePopOutChannel');
    });

    it('sends popout-opened on mount', () => {
        expect(SOURCE).toContain("'popout-opened'");
    });

    it('sends popout-closed on beforeunload', () => {
        expect(SOURCE).toContain("'popout-closed'");
        expect(SOURCE).toContain("'beforeunload'");
    });

    it('closes window on popout-restore message', () => {
        expect(SOURCE).toContain("'popout-restore'");
        expect(SOURCE).toContain("window.close()");
    });
});

describe('PopOutActivityShell: route parsing', () => {
    it('parses taskId from #popout/activity/:taskId hash', () => {
        expect(SOURCE).toContain("parts[0] !== 'popout'");
        expect(SOURCE).toContain("parts[1] !== 'activity'");
        expect(SOURCE).toContain("decodeURIComponent(parts[2])");
    });

    it('reads workspaceId from URLSearchParams', () => {
        expect(SOURCE).toContain("URLSearchParams");
        expect(SOURCE).toContain("'workspace'");
    });

    it('returns null for invalid hash', () => {
        expect(SOURCE).toContain("return null");
    });

    it('renders invalid URL message for unknown routes', () => {
        expect(SOURCE).toContain("Invalid pop-out URL");
    });
});

describe('PopOutActivityShell: data-testid', () => {
    it('has data-testid for the shell container', () => {
        expect(SOURCE).toContain('data-testid="popout-shell"');
    });
});
