/**
 * Tests for MarkdownReviewDialog minimize feature.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { MarkdownReviewDialog } from '../../../src/server/spa/client/react/processes/MarkdownReviewDialog';

/* ── Mutable breakpoint mock ────────────────────────────────────────────── */

const mockBreakpoint = { isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const };

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => mockBreakpoint,
}));

/* ── BottomSheet stub ────────────────────────────────────────────────────── */

vi.mock('../../../src/server/spa/client/react/ui/BottomSheet', () => ({
    BottomSheet: ({ isOpen, onClose, title, children, height }: any) =>
        isOpen ? (
            <div data-testid="bottomsheet-mock" data-title={title} data-height={height}>
                <button data-testid="bottomsheet-close" onClick={onClose}>close</button>
                {children}
            </div>
        ) : null,
}));

/* ── Mocks required by MarkdownReviewEditor (used inside the dialog) ── */

vi.mock('../../../src/server/spa/client/react/tasks/hooks/useTaskComments', () => ({
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

vi.mock('../../../src/server/spa/client/react/hooks/ui/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({
        html: content ? `<p>${content}</p>` : '',
    }),
}));

vi.mock('@plusplusoneplusplus/forge/editor/anchor', () => ({
    createAnchorData: vi.fn(),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

vi.mock('../../../src/server/spa/client/react/utils/document-context', () => ({
    extractDocumentContext: vi.fn(() => ({ surroundingLines: '', nearestHeading: null, allHeadings: [] })),
}));

const mockAddToast = vi.fn();
vi.mock('../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }),
}));

vi.mock('../../../src/server/spa/client/react/shared/SourceEditor', () => ({
    SourceEditor: ({ content, onChange }: { content: string; onChange: (v: string) => void }) => (
        <textarea data-testid="source-editor" value={content} onChange={(e) => onChange(e.target.value)} />
    ),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
}));

vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/MarkdownPopOutContext', () => ({
    useMarkdownPopOut: () => ({ markPoppedOut: vi.fn(), isPoppedOut: vi.fn(() => false) }),
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
    mockBreakpoint.isMobile = false;
    mockBreakpoint.isTablet = false;
    mockBreakpoint.isDesktop = true;
    mockBreakpoint.breakpoint = 'desktop';
    cleanup();
    vi.restoreAllMocks();
});

describe('MarkdownReviewDialog', () => {
    beforeEach(() => {
        setupFetch();
        mockAddToast.mockClear();
    });

    it('renders nothing when open=false', () => {
        const { container } = render(
            <MarkdownReviewDialog
                open={false}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when wsId is null', () => {
        const { container } = render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId={null}
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when filePath is null', () => {
        const { container } = render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath={null}
                displayPath={null}
                fetchMode="tasks"
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('shows the file title when open', async () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="plan.md"
                displayPath="/data/repos/abc/tasks/coc/plan.md"
                fetchMode="tasks"
            />
        );
        // title should be the basename
        expect(document.body.textContent).toContain('plan.md');
    });

    it('renders minimize button when onMinimize is provided', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Minimize');
    });

    it('does not render minimize button when onMinimize is not provided', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]');
        expect(btn).toBeNull();
    });

    it('clicking minimize button calls onMinimize with a number', async () => {
        const onMinimize = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={onMinimize}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]') as HTMLElement;
        fireEvent.click(btn);
        expect(onMinimize).toHaveBeenCalledOnce();
        expect(typeof onMinimize.mock.calls[0][0]).toBe('number');
    });

    it('onMinimize receives scrollTop=0 by default (no scrolling occurred)', () => {
        const onMinimize = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={onMinimize}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]') as HTMLElement;
        fireEvent.click(btn);
        expect(onMinimize).toHaveBeenCalledWith(0);
    });

    it('clicking close button calls onClose', () => {
        const onClose = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        // Find the close button (aria-label="Close")
        const closeBtn = document.querySelector('[aria-label="Close"]') as HTMLElement;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('close button does not call onMinimize', () => {
        const onMinimize = vi.fn();
        const onClose = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                onMinimize={onMinimize}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const closeBtn = document.querySelector('[aria-label="Close"]') as HTMLElement;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
        expect(onMinimize).not.toHaveBeenCalled();
    });

    it('Escape key closes instead of minimizing when onMinimize is provided', () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                onMinimize={onMinimize}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        expect(onMinimize).not.toHaveBeenCalled();
    });

    it('Escape key calls onClose when onMinimize is not provided', () => {
        const onClose = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('renders exactly one minimize button when onMinimize is provided (no duplicates)', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const minimizeBtns = document.querySelectorAll('[aria-label="Minimize"]');
        expect(minimizeBtns.length).toBe(1);
    });

    it('renders exactly one close button (no duplicates)', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const closeBtns = document.querySelectorAll('[aria-label="Close"]');
        expect(closeBtns.length).toBe(1);
    });

    it('renders pop-out button', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-popout-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Open in new window');
    });

    it('pop-out button calls window.open with named target and dimensions, then closes', () => {
        const mockPopup = { focus: vi.fn() };
        const windowOpenSpy = vi.spyOn(window, 'open').mockReturnValue(mockPopup as any);
        const onClose = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-popout-btn"]') as HTMLElement;
        fireEvent.click(btn);
        expect(windowOpenSpy).toHaveBeenCalledOnce();
        const [url, target, features] = windowOpenSpy.mock.calls[0];
        expect(url).toContain('#popout/markdown');
        expect(url).toContain('workspace=ws1');
        expect(url).toContain('filePath=test.md');
        // Named target for window reuse (not '_blank')
        expect(target).toMatch(/^coc-md-popout-/);
        // Window features to force a separate window
        expect(features).toContain('width=900');
        expect(features).toContain('height=700');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('pop-out button does not close dialog and shows toast when popup is blocked', () => {
        vi.spyOn(window, 'open').mockReturnValue(null);
        const onClose = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-popout-btn"]') as HTMLElement;
        fireEvent.click(btn);
        expect(onClose).not.toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith(
            'Pop-out blocked. Allow popups for this site and try again.',
            'error',
        );
    });

    it('renders inside a FloatingDialog (portal to body)', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const panel = document.querySelector('[data-testid="floating-dialog-panel"]');
        expect(panel).not.toBeNull();
    });

    it('renders maximize button', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-maximize-btn"]');
        expect(btn).not.toBeNull();
    });

    it('clicking maximize button toggles aria-label from Maximize to Restore', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-maximize-btn"]') as HTMLElement;
        expect(btn.getAttribute('aria-label')).toBe('Maximize');
        fireEvent.click(btn);
        expect(btn.getAttribute('aria-label')).toBe('Restore');
        fireEvent.click(btn);
        expect(btn.getAttribute('aria-label')).toBe('Maximize');
    });

    describe('selectable title and path text', () => {
        it('desktop title element has select-text and cursor-text classes', () => {
            render(
                <MarkdownReviewDialog
                    open={true}
                    onClose={vi.fn()}
                    wsId="ws1"
                    filePath="plan.md"
                    displayPath="/workspace/plan.md"
                    fetchMode="tasks"
                />
            );
            // title is basename: "plan.md"
            const titleEl = document.querySelector('.text-sm.font-semibold.select-text.cursor-text');
            expect(titleEl).not.toBeNull();
            expect(titleEl!.textContent).toBe('plan.md');
        });

        it('desktop path element has select-text and cursor-text classes', () => {
            render(
                <MarkdownReviewDialog
                    open={true}
                    onClose={vi.fn()}
                    wsId="ws1"
                    filePath="plan.md"
                    displayPath="/workspace/plan.md"
                    fetchMode="tasks"
                />
            );
            const pathEl = document.querySelector('.text-xs.select-text.cursor-text');
            expect(pathEl).not.toBeNull();
            expect(pathEl!.textContent).toBe('/workspace/plan.md');
        });

        it('mouseDown on desktop title calls stopPropagation to prevent drag', () => {
            render(
                <MarkdownReviewDialog
                    open={true}
                    onClose={vi.fn()}
                    wsId="ws1"
                    filePath="plan.md"
                    displayPath="/workspace/plan.md"
                    fetchMode="tasks"
                />
            );
            const titleEl = document.querySelector('.text-sm.font-semibold.select-text.cursor-text')!;
            const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            const stopSpy = vi.spyOn(event, 'stopPropagation');
            titleEl.dispatchEvent(event);
            expect(stopSpy).toHaveBeenCalled();
        });

        it('mouseDown on desktop path calls stopPropagation to prevent drag', () => {
            render(
                <MarkdownReviewDialog
                    open={true}
                    onClose={vi.fn()}
                    wsId="ws1"
                    filePath="plan.md"
                    displayPath="/workspace/plan.md"
                    fetchMode="tasks"
                />
            );
            const pathEl = document.querySelector('.text-xs.select-text.cursor-text')!;
            const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            const stopSpy = vi.spyOn(event, 'stopPropagation');
            pathEl.dispatchEvent(event);
            expect(stopSpy).toHaveBeenCalled();
        });
    });

    it('pop-out button has aria-label "Open in new window"', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-popout-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Open in new window');
    });

    it('pop-out uses deterministic named target derived from wsId and filePath', () => {
        const windowOpenSpy = vi.spyOn(window, 'open').mockReturnValue({ focus: vi.fn() } as any);
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="src/readme.md"
                displayPath="/workspace/src/readme.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-popout-btn"]') as HTMLElement;
        fireEvent.click(btn);
        const target = windowOpenSpy.mock.calls[0][1] as string;
        // Target encodes wsId + filePath, sanitised for window.open
        expect(target).toBe('coc-md-popout-ws1__src_readme_md');
    });
});

describe('MarkdownReviewDialog — mobile (BottomSheet)', () => {
    beforeEach(() => {
        setupFetch();
        mockAddToast.mockClear();
        mockBreakpoint.isMobile = true;
        mockBreakpoint.isTablet = false;
        mockBreakpoint.isDesktop = false;
        mockBreakpoint.breakpoint = 'mobile';
    });

    it('renders nothing when open=false on mobile', () => {
        const { container } = render(
            <MarkdownReviewDialog
                open={false}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders BottomSheet instead of FloatingDialog on mobile', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        expect(screen.getByTestId('bottomsheet-mock')).toBeTruthy();
        expect(document.querySelector('[data-testid="floating-dialog-panel"]')).toBeNull();
    });

    it('BottomSheet uses 90% height on mobile', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        expect(screen.getByTestId('bottomsheet-mock').dataset['height']).toBe('90');
    });

    it('BottomSheet title shows file basename', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="/workspace/tasks/plan.md"
                displayPath="/workspace/tasks/plan.md"
                fetchMode="tasks"
            />
        );
        expect(screen.getByTestId('bottomsheet-mock').dataset['title']).toBe('plan.md');
    });

    it('renders reveal button inside BottomSheet on mobile', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-reveal-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Reveal in Explorer');
    });

    it('renders pop-out button inside BottomSheet on mobile', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-popout-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Open in new window');
    });

    it('close button inside BottomSheet calls onClose', () => {
        const onClose = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={onClose}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const closeBtn = document.querySelector('[aria-label="Close"]') as HTMLElement;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('renders minimize button in BottomSheet when onMinimize is provided', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]');
        expect(btn).not.toBeNull();
        expect(btn!.getAttribute('aria-label')).toBe('Minimize');
    });

    it('does not render minimize button when onMinimize is absent', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        expect(document.querySelector('[data-testid="markdown-review-minimize-btn"]')).toBeNull();
    });

    it('clicking minimize button in BottomSheet calls onMinimize with scrollTop', () => {
        const onMinimize = vi.fn();
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                onMinimize={onMinimize}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const btn = document.querySelector('[data-testid="markdown-review-minimize-btn"]') as HTMLElement;
        fireEvent.click(btn);
        expect(onMinimize).toHaveBeenCalledOnce();
        expect(typeof onMinimize.mock.calls[0][0]).toBe('number');
    });

    it('does not render maximize button in BottomSheet mode', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        expect(document.querySelector('[data-testid="markdown-review-maximize-btn"]')).toBeNull();
    });

    it('stamps data-ws-id on BottomSheet content wrapper', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws-mobile"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const wsEl = document.querySelector('[data-ws-id="ws-mobile"]');
        expect(wsEl).not.toBeNull();
    });

    it('data-ws-id wrapper in BottomSheet has flex layout classes for scrollability', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws-mobile"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const wsEl = document.querySelector('[data-ws-id="ws-mobile"]');
        expect(wsEl).not.toBeNull();
        const classes = wsEl!.className;
        expect(classes).toContain('flex-1');
        expect(classes).toContain('min-h-0');
        expect(classes).toContain('overflow-hidden');
        expect(classes).toContain('flex-col');
    });
});

describe('MarkdownReviewDialog — data-ws-id on desktop FloatingDialog', () => {
    beforeEach(() => {
        setupFetch();
        mockBreakpoint.isMobile = false;
        mockBreakpoint.isDesktop = true;
    });

    it('stamps data-ws-id on FloatingDialog content wrapper', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws-desktop"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const wsEl = document.querySelector('[data-ws-id="ws-desktop"]');
        expect(wsEl).not.toBeNull();
    });

    it('data-ws-id wrapper in FloatingDialog has flex layout classes for scrollability', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws-desktop"
                filePath="test.md"
                displayPath="/workspace/test.md"
                fetchMode="tasks"
            />
        );
        const wsEl = document.querySelector('[data-ws-id="ws-desktop"]');
        expect(wsEl).not.toBeNull();
        const classes = wsEl!.className;
        expect(classes).toContain('flex-1');
        expect(classes).toContain('min-h-0');
        expect(classes).toContain('overflow-hidden');
        expect(classes).toContain('flex-col');
    });
});

describe('MarkdownReviewDialog — NoteEditor rendering', () => {
    beforeEach(() => {
        setupFetch();
        mockBreakpoint.isMobile = false;
        mockBreakpoint.isDesktop = true;
    });

    it('renders the NoteEditor shell when fetchMode=tasks', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="plan.md"
                displayPath="/workspace/tasks/plan.md"
                fetchMode="tasks"
            />
        );
        expect(document.querySelector('[data-testid="markdown-review-note-editor"]')).not.toBeNull();
    });

    it('renders the NoteEditor shell when fetchMode=auto (no legacy MarkdownReviewEditor)', () => {
        render(
            <MarkdownReviewDialog
                open={true}
                onClose={vi.fn()}
                wsId="ws1"
                filePath="docs/readme.md"
                displayPath="/workspace/docs/readme.md"
                fetchMode="auto"
            />
        );
        expect(document.querySelector('[data-testid="markdown-review-note-editor"]')).not.toBeNull();
        // Legacy editor's mode toggle / source-editor textarea should be absent.
        expect(document.querySelector('[data-testid="source-editor"]')).toBeNull();
    });
});
