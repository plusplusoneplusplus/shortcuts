/**
 * Tests for PopOutMarkdownShell.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
    parsePopOutMarkdownRoute,
    mdPopOutKey,
} from '../../../../src/server/spa/client/react/layout/PopOutMarkdownShell';

/* ── Mocks ── */

vi.mock('../../../../src/server/spa/client/react/tasks/hooks/useTaskComments', () => ({
    useTaskComments: () => ({
        comments: [],
        loading: false,
        addComment: vi.fn(),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
        resolveWithAI: vi.fn(),
        fixWithAI: vi.fn(),
        copyResolvePrompt: vi.fn(),

        refresh: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({
        html: content ? `<p>${content}</p>` : '',
    }),
}));

vi.mock('@plusplusoneplusplus/forge/editor/anchor', () => ({
    createAnchorData: vi.fn(),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

vi.mock('../../../../src/server/spa/client/react/utils/document-context', () => ({
    extractDocumentContext: vi.fn(() => ({ surroundingLines: '', nearestHeading: null, allHeadings: [] })),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/SourceEditor', () => ({
    SourceEditor: ({ content, onChange }: { content: string; onChange: (v: string) => void }) => (
        <textarea data-testid="source-editor" value={content} onChange={(e) => onChange(e.target.value)} />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: [] }, dispatch: vi.fn() }),
    AppProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    QueueProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useQueue: () => ({ state: { queued: [], running: [], history: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function setupFetch(content = '# Hello') {
    const fetchSpy = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/tasks/content') || url.includes('/files/preview')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ content }),
                text: async () => JSON.stringify({ content }),
            } as Response);
        }
        return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ comments: [] }),
            text: async () => '{}',
        } as Response);
    });
    (global as any).fetch = fetchSpy;
    return fetchSpy;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('parsePopOutMarkdownRoute', () => {
    it('parses valid route with all params', () => {
        const result = parsePopOutMarkdownRoute(
            '#popout/markdown',
            '?workspace=ws1&filePath=plan.md&fetchMode=tasks&displayPath=/data/plan.md'
        );
        expect(result).toEqual({
            wsId: 'ws1',
            filePath: 'plan.md',
            displayPath: '/data/plan.md',
            fetchMode: 'tasks',
        });
    });

    it('defaults fetchMode to auto', () => {
        const result = parsePopOutMarkdownRoute(
            '#popout/markdown',
            '?workspace=ws1&filePath=plan.md'
        );
        expect(result).not.toBeNull();
        expect(result!.fetchMode).toBe('auto');
    });

    it('defaults displayPath to filePath', () => {
        const result = parsePopOutMarkdownRoute(
            '#popout/markdown',
            '?workspace=ws1&filePath=plan.md'
        );
        expect(result).not.toBeNull();
        expect(result!.displayPath).toBe('plan.md');
    });

    it('returns null for invalid hash', () => {
        expect(parsePopOutMarkdownRoute('#popout/activity/123', '?workspace=ws1&filePath=plan.md')).toBeNull();
        expect(parsePopOutMarkdownRoute('#other', '?workspace=ws1&filePath=plan.md')).toBeNull();
    });

    it('returns null when workspace is missing', () => {
        expect(parsePopOutMarkdownRoute('#popout/markdown', '?filePath=plan.md')).toBeNull();
    });

    it('returns null when filePath is missing', () => {
        expect(parsePopOutMarkdownRoute('#popout/markdown', '?workspace=ws1')).toBeNull();
    });
});

describe('mdPopOutKey', () => {
    it('creates composite key from wsId and filePath', () => {
        expect(mdPopOutKey('ws1', 'plan.md')).toBe('ws1::plan.md');
    });
});

describe('PopOutMarkdownShell', () => {
    beforeEach(() => {
        setupFetch();
    });

    it('renders invalid URL message for unknown routes', async () => {
        // Set hash to something invalid
        Object.defineProperty(window, 'location', {
            value: { ...window.location, hash: '#popout/other', search: '' },
            writable: true,
        });
        const { PopOutMarkdownShell } = await import(
            '../../../../src/server/spa/client/react/layout/PopOutMarkdownShell'
        );
        render(<PopOutMarkdownShell />);
        expect(document.body.textContent).toContain('Invalid pop-out URL');
    });
});
