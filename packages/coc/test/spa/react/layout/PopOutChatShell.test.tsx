/**
 * Tests for PopOutChatShell (source-level verification).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    parsePopOutActivityRoute,
} from '../../../../src/server/spa/client/react/layout/PopOutChatShell';

const LAYOUT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'layout'
);
const SOURCE = fs.readFileSync(path.join(LAYOUT_DIR, 'PopOutChatShell.tsx'), 'utf-8');

describe('PopOutChatShell: structure', () => {
    it('exports PopOutChatShell component', () => {
        expect(SOURCE).toContain('export function PopOutChatShell');
    });

    it('exports parsePopOutActivityRoute helper', () => {
        expect(SOURCE).toContain('export function parsePopOutActivityRoute');
    });

    it('exports PopOutRouteParams type', () => {
        expect(SOURCE).toContain('export interface PopOutRouteParams');
    });
});

describe('PopOutChatShell: providers', () => {
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

describe('PopOutChatShell: ChatDetail usage', () => {
    it('renders ChatDetail', () => {
        expect(SOURCE).toContain('<ChatDetail');
    });

    it('passes isPopOut={true} to ChatDetail', () => {
        expect(SOURCE).toContain('isPopOut={true}');
    });

    it('passes workspaceId to ChatDetail', () => {
        expect(SOURCE).toContain('workspaceId=');
    });
});

describe('PopOutChatShell: BroadcastChannel communication', () => {
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

describe('PopOutChatShell: route parsing', () => {
    it('parses taskId from #popout/activity/:taskId hash', () => {
        expect(SOURCE).toContain("parts[0] !== 'popout'");
        expect(SOURCE).toContain("parts[1] !== 'activity'");
        expect(SOURCE).toContain("decodeURIComponent(parts[2])");
    });

    it('reads workspaceId from URLSearchParams', () => {
        expect(SOURCE).toContain("URLSearchParams");
        expect(SOURCE).toContain("'workspace'");
    });

    it('parses workspace and cloneBaseUrl from the query string', () => {
        expect(parsePopOutActivityRoute(
            '#popout/activity/task%2F1',
            '?workspace=ws1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000'
        )).toEqual({
            taskId: 'task/1',
            workspaceId: 'ws1',
            cloneBaseUrl: 'http://127.0.0.1:4000',
        });
    });

    it('returns null for invalid hash', () => {
        expect(SOURCE).toContain("return null");
    });

    it('renders invalid URL message for unknown routes', () => {
        expect(SOURCE).toContain("Invalid pop-out URL");
    });
});

describe('PopOutChatShell: data-testid', () => {
    it('has data-testid for the shell container', () => {
        expect(SOURCE).toContain('data-testid="popout-shell"');
    });
});

describe('PopOutChatShell: remote clone registry bootstrap', () => {
    it('imports registerCloneBaseUrls for remote pop-out routing', () => {
        expect(SOURCE).toContain('registerCloneBaseUrls');
    });

    it('seeds registry from cloneBaseUrl param before rendering children', () => {
        expect(SOURCE).toContain('parsed?.workspaceId && parsed.cloneBaseUrl');
        expect(SOURCE).toContain('registerCloneBaseUrls([{ workspaceId');
    });
});
