import { act, createEvent, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearReviewChatMinimized,
    getReviewChatMinimizedStorageKey,
    getReviewChatOpenStorageKey,
    getReviewChatPlacementStorageKey,
    isCommitChatPinned,
    isReviewChatPinned,
    pinReviewChat,
    readReviewChatMinimized,
    readReviewChatOpen,
    resolveReviewChatPresentation,
    unpinReviewChat,
    writeReviewChatMinimized,
    writeReviewChatOpen,
    type ReviewChatTarget,
} from '../../../src/server/spa/client/react/features/git/commits/commitChatPlacement';
import { useReviewChatPresentation } from '../../../src/server/spa/client/react/features/git/hooks/useReviewChatPresentation';
import { ReviewChatPlacementFrame } from '../../../src/server/spa/client/react/features/git/reviewChat/ReviewChatPlacementFrame';
import {
    DASHBOARD_CONFIG_UPDATED_EVENT,
    _resetRuntimeConfig,
    applyRuntimeConfigPatch,
} from '../../../src/server/spa/client/react/utils/config';

beforeEach(() => {
    localStorage.clear();
    _resetRuntimeConfig();
    (window as any).__DASHBOARD_CONFIG__ = {
        apiBasePath: '/api',
        wsPath: '/ws',
        commitChatLensEnabled: true,
    };
});

describe('review chat placement storage', () => {
    it('resolves lens only when the feature is enabled, desktop, and unpinned', () => {
        expect(resolveReviewChatPresentation({ lensEnabled: false, isDesktop: true, pinned: false })).toBe('side-panel');
        expect(resolveReviewChatPresentation({ lensEnabled: true, isDesktop: false, pinned: false })).toBe('side-panel');
        expect(resolveReviewChatPresentation({ lensEnabled: true, isDesktop: true, pinned: true })).toBe('side-panel');
        expect(resolveReviewChatPresentation({ lensEnabled: true, isDesktop: true, pinned: false })).toBe('lens');
    });

    it('scopes open state by review target and workspace', () => {
        const first: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-a', commitHash: 'abc123' };
        const sameCommitOtherWorkspace: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-b', commitHash: 'abc123' };

        writeReviewChatOpen(first, true);

        expect(readReviewChatOpen(first)).toBe(true);
        expect(readReviewChatOpen(sameCommitOtherWorkspace)).toBe(false);
    });

    it('builds PR storage keys with workspace, repo, PR id, and head SHA', () => {
        const target: ReviewChatTarget = {
            type: 'pr',
            workspaceId: 'ws-a',
            repoId: 'repo-a',
            prId: '#123',
            headSha: 'head/sha',
        };

        expect(getReviewChatOpenStorageKey(target)).toBe('coc.reviewChat.open.pr.ws-a.repo-a.%23123.head%2Fsha');
        expect(getReviewChatPlacementStorageKey(target)).toBe('coc.reviewChat.placement.pr.ws-a.repo-a.%23123.head%2Fsha');
        expect(getReviewChatMinimizedStorageKey(target)).toBe('coc.reviewChat.minimized.pr.ws-a.repo-a.%23123.head%2Fsha');
        expect(getReviewChatPlacementStorageKey({ ...target, headSha: undefined })).toBe('coc.reviewChat.placement.pr.ws-a.repo-a.%23123.current');
    });

    it('builds notes storage keys scoped by workspace', () => {
        const first: ReviewChatTarget = { type: 'notes', workspaceId: 'ws-a' };
        const second: ReviewChatTarget = { type: 'notes', workspaceId: 'ws-b' };

        writeReviewChatOpen(first, true);
        pinReviewChat(first);

        expect(getReviewChatOpenStorageKey(first)).toBe('coc.reviewChat.open.notes.ws-a');
        expect(getReviewChatPlacementStorageKey(first)).toBe('coc.reviewChat.placement.notes.ws-a');
        expect(getReviewChatMinimizedStorageKey(first)).toBe('coc.reviewChat.minimized.notes.ws-a');
        expect(readReviewChatOpen(first)).toBe(true);
        expect(readReviewChatOpen(second)).toBe(false);
        expect(isReviewChatPinned(first)).toBe(true);
        expect(isReviewChatPinned(second)).toBe(false);
    });

    it('scopes minimized state by review target and clears it without affecting other workspaces', () => {
        const first: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-a', commitHash: 'abc123' };
        const sameCommitOtherWorkspace: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-b', commitHash: 'abc123' };

        writeReviewChatMinimized(first, true);

        expect(readReviewChatMinimized(first)).toBe(true);
        expect(readReviewChatMinimized(sameCommitOtherWorkspace)).toBe(false);

        clearReviewChatMinimized(first);

        expect(readReviewChatMinimized(first)).toBe(false);
    });

    it('scopes pinned placement by review target and preserves legacy commit pinned reads', () => {
        const commit: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-a', commitHash: 'abc123' };
        const otherWorkspace: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-b', commitHash: 'abc123' };
        const pr: ReviewChatTarget = { type: 'pr', workspaceId: 'ws-a', repoId: 'repo-a', prId: '123', headSha: 'sha-a' };

        pinReviewChat(commit);
        pinReviewChat(pr);

        expect(isReviewChatPinned(commit)).toBe(true);
        expect(isReviewChatPinned(pr)).toBe(true);
        expect(isReviewChatPinned(otherWorkspace)).toBe(false);

        unpinReviewChat(commit);
        expect(isReviewChatPinned(commit)).toBe(false);

        localStorage.setItem('coc.commitChat.placement.ws-a.abc123', 'side-panel');
        expect(isCommitChatPinned('ws-a', 'abc123')).toBe(true);
    });

    it('clears minimized state when a target is pinned', () => {
        const target: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-a', commitHash: 'abc123' };
        writeReviewChatMinimized(target, true);

        pinReviewChat(target);

        expect(isReviewChatPinned(target)).toBe(true);
        expect(readReviewChatMinimized(target)).toBe(false);
    });
});

describe('ReviewChatPlacementFrame', () => {
    let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;
    let originalInnerWidth: number;
    let originalInnerHeight: number;

    beforeEach(() => {
        originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
        originalInnerWidth = window.innerWidth;
        originalInnerHeight = window.innerHeight;
    });

    afterEach(() => {
        Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    it('renders shared lens chrome with contextual title, identifier, close, minimize, and pin controls', () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        const onPin = vi.fn();

        render(
            <ReviewChatPlacementFrame
                title="PR Chat"
                identifier="#123"
                presentation="lens"
                onClose={onClose}
                onMinimize={onMinimize}
                onPin={onPin}
                testIdPrefix="pr-chat"
            >
                <div data-testid="chat-body">Body</div>
            </ReviewChatPlacementFrame>,
        );

        expect(screen.getByTestId('pr-chat-lens')).toBeInTheDocument();
        const resizeGrip = screen.getByTestId('pr-chat-lens-resize-grip');
        expect(resizeGrip).toBeInTheDocument();
        expect(resizeGrip).toHaveClass('cursor-nwse-resize', 'h-3.5', 'w-3.5');
        expect(resizeGrip.className).not.toContain('bg-');
        expect(resizeGrip.className).not.toContain('shadow');
        expect(screen.getByTestId('pr-chat-lens-header')).toHaveTextContent('PR Chat');
        expect(screen.getByTestId('pr-chat-lens-header')).toHaveTextContent('#123');
        expect(screen.getByTestId('chat-body')).toBeInTheDocument();

        const minimizeButton = screen.getByRole('button', { name: 'Minimize chat lens' });
        expect(minimizeButton).toBe(screen.getByTestId('pr-chat-minimize-btn'));
        expect(minimizeButton).not.toHaveTextContent('Minimize');
        expect(minimizeButton.querySelector('svg')).toBeInTheDocument();
        fireEvent.click(minimizeButton);
        expect(onMinimize).toHaveBeenCalledTimes(1);

        const pinButton = screen.getByRole('button', { name: 'Pin to side panel' });
        expect(pinButton).toBe(screen.getByTestId('pr-chat-pin-btn'));
        expect(pinButton).not.toHaveTextContent('Pin');
        expect(pinButton.querySelector('svg')).toBeInTheDocument();
        fireEvent.click(pinButton);
        expect(onPin).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByTestId('pr-chat-frame-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders a minimized lens pill that hides body content and restores from the pill or button', () => {
        const onRestore = vi.fn();

        render(
            <ReviewChatPlacementFrame
                title="Commit Chat"
                identifier="abc1234"
                presentation="lens"
                onClose={vi.fn()}
                isMinimized
                onRestore={onRestore}
                testIdPrefix="commit-chat"
            >
                <div data-testid="chat-body">Body</div>
            </ReviewChatPlacementFrame>,
        );

        expect(screen.getByTestId('commit-chat-lens-minimized')).toHaveTextContent('Commit Chat');
        expect(screen.queryByTestId('commit-chat-lens-resize-grip')).not.toBeInTheDocument();
        expect(screen.getByTestId('commit-chat-lens-minimized')).toHaveTextContent('abc1234');
        expect(screen.getByTestId('commit-chat-lens-hidden-body')).toHaveClass('hidden');
        expect(screen.getByTestId('chat-body')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('commit-chat-lens-minimized'));
        expect(onRestore).toHaveBeenCalledTimes(1);

        onRestore.mockClear();
        fireEvent.click(screen.getByTestId('commit-chat-restore-btn'));
        expect(onRestore).toHaveBeenCalledTimes(1);
    });

    it('renders side-panel chrome with an unpin control', () => {
        const onUnpin = vi.fn();

        render(
            <ReviewChatPlacementFrame
                title="Commit Chat"
                identifier="abc1234"
                presentation="side-panel"
                onClose={vi.fn()}
                isMinimized
                onMinimize={vi.fn()}
                onRestore={vi.fn()}
                onUnpin={onUnpin}
                testIdPrefix="commit-chat"
            >
                <div />
            </ReviewChatPlacementFrame>,
        );

        expect(screen.getByTestId('commit-chat-side-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('commit-chat-lens-minimized')).not.toBeInTheDocument();
        expect(screen.queryByTestId('commit-chat-lens-resize-grip')).not.toBeInTheDocument();
        expect(screen.queryByTestId('commit-chat-minimize-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('commit-chat-pin-btn')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('commit-chat-unpin-btn'));
        expect(onUnpin).toHaveBeenCalledTimes(1);
    });

    it('resizes the lens from the top-left grip while keeping the bottom-right anchor classes', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
        Element.prototype.getBoundingClientRect = () => ({
            left: 564,
            top: 360,
            right: 984,
            bottom: 784,
            width: 420,
            height: 424,
            x: 564,
            y: 360,
            toJSON: () => ({}),
        });

        render(
            <ReviewChatPlacementFrame
                title="PR Chat"
                identifier="#123"
                presentation="lens"
                onClose={vi.fn()}
                testIdPrefix="pr-chat"
            >
                <div />
            </ReviewChatPlacementFrame>,
        );

        const lens = screen.getByTestId('pr-chat-lens');
        const grip = screen.getByTestId('pr-chat-lens-resize-grip');

        fireEvent.mouseDown(grip, { clientX: 564, clientY: 360 });
        fireEvent.mouseMove(window, { clientX: 464, clientY: 260 });

        expect(lens.style.width).toBe('520px');
        expect(lens.style.height).toBe('524px');
        expect(lens.className).toContain('bottom-4');
        expect(lens.className).toContain('right-4');

        fireEvent.mouseMove(window, { clientX: 664, clientY: 460 });

        expect(lens.style.width).toBe('320px');
        expect(lens.style.height).toBe('324px');

        fireEvent.mouseUp(window);
    });

    it('clamps top-left resize to viewport bounds', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
        Element.prototype.getBoundingClientRect = () => ({
            left: 264,
            top: 160,
            right: 684,
            bottom: 584,
            width: 420,
            height: 424,
            x: 264,
            y: 160,
            toJSON: () => ({}),
        });

        render(
            <ReviewChatPlacementFrame
                title="Commit Chat"
                identifier="abc1234"
                presentation="lens"
                onClose={vi.fn()}
                testIdPrefix="commit-chat"
            >
                <div />
            </ReviewChatPlacementFrame>,
        );

        const lens = screen.getByTestId('commit-chat-lens');

        fireEvent.mouseDown(screen.getByTestId('commit-chat-lens-resize-grip'), { clientX: 264, clientY: 160 });
        fireEvent.mouseMove(window, { clientX: -400, clientY: -400 });

        expect(lens.style.width).toBe('668px');
        expect(lens.style.height).toBe('568px');

        fireEvent.mouseUp(window);
    });

    it('does not persist resized dimensions across remounts', () => {
        Element.prototype.getBoundingClientRect = () => ({
            left: 564,
            top: 360,
            right: 984,
            bottom: 784,
            width: 420,
            height: 424,
            x: 564,
            y: 360,
            toJSON: () => ({}),
        });

        const view = render(
            <ReviewChatPlacementFrame
                title="Work Item Chat"
                presentation="lens"
                onClose={vi.fn()}
                testIdPrefix="work-item-chat"
            >
                <div />
            </ReviewChatPlacementFrame>,
        );

        fireEvent.mouseDown(screen.getByTestId('work-item-chat-lens-resize-grip'), { clientX: 564, clientY: 360 });
        fireEvent.mouseMove(window, { clientX: 464, clientY: 260 });

        expect(screen.getByTestId('work-item-chat-lens').style.width).toBe('520px');

        view.unmount();
        render(
            <ReviewChatPlacementFrame
                title="Work Item Chat"
                presentation="lens"
                onClose={vi.fn()}
                testIdPrefix="work-item-chat"
            >
                <div />
            </ReviewChatPlacementFrame>,
        );

        expect(screen.getByTestId('work-item-chat-lens').style.width).toBe('');
        expect(localStorage.length).toBe(0);
    });
});

describe('ReviewChatPlacementFrame chat drop target', () => {
    const SESSION_MIME = 'application/vnd.coc.session-context+json';
    const POINTER_MIME = 'application/vnd.coc.pointer-context+json';

    function sessionPayload(overrides: Record<string, unknown> = {}) {
        return {
            kind: 'coc.session-context',
            version: 1,
            sourceWorkspaceId: 'ws-a',
            sourceProcessId: 'queue_task-dropped',
            title: 'An earlier conversation',
            status: 'completed',
            lastActivityAt: '2026-03-07T12:00:00.000Z',
            ...overrides,
        };
    }

    /** Minimal DataTransfer stand-in: `types` for dragover, `getData` for drop. */
    function dataTransferFor(entries: Record<string, string>) {
        return {
            types: Object.keys(entries),
            getData: (type: string) => entries[type] ?? '',
            dropEffect: 'none',
        };
    }

    function sessionDataTransfer(overrides: Record<string, unknown> = {}) {
        return dataTransferFor({ [SESSION_MIME]: JSON.stringify(sessionPayload(overrides)) });
    }

    function renderFrame(props: Record<string, unknown> = {}) {
        const onParentDrop = vi.fn();
        const view = render(
            <div onDrop={onParentDrop} data-testid="drop-parent">
                <ReviewChatPlacementFrame
                    title="Commit Chat"
                    identifier="abc1234"
                    presentation="lens"
                    onClose={vi.fn()}
                    testIdPrefix="commit-chat"
                    {...props}
                >
                    <div data-testid="chat-body">Body</div>
                </ReviewChatPlacementFrame>
            </div>,
        );
        return { ...view, onParentDrop, frame: screen.getByTestId('commit-chat-lens') };
    }

    it('loads a dropped same-workspace chat and stops the drop from also attaching it as context', async () => {
        const onDropExistingChat = vi.fn();
        const { frame, onParentDrop } = renderFrame({ onDropExistingChat, dropWorkspaceId: 'ws-a' });

        await act(async () => {
            fireEvent.drop(frame, { dataTransfer: sessionDataTransfer() });
        });

        expect(onDropExistingChat).toHaveBeenCalledWith('queue_task-dropped');
        expect(onParentDrop).not.toHaveBeenCalled();
        expect(screen.queryByTestId('commit-chat-drop-rejection')).not.toBeInTheDocument();
    });

    it('refuses a chat dragged in from another workspace', async () => {
        const onDropExistingChat = vi.fn();
        const { frame } = renderFrame({ onDropExistingChat, dropWorkspaceId: 'ws-a' });

        await act(async () => {
            fireEvent.drop(frame, { dataTransfer: sessionDataTransfer({ sourceWorkspaceId: 'ws-b' }) });
        });

        expect(onDropExistingChat).not.toHaveBeenCalled();
        expect(screen.getByTestId('commit-chat-drop-rejection'))
            .toHaveTextContent('That chat belongs to a different workspace.');

        fireEvent.click(screen.getByTestId('commit-chat-drop-rejection-dismiss'));
        expect(screen.queryByTestId('commit-chat-drop-rejection')).not.toBeInTheDocument();
    });

    it('lets a non-session payload bubble through untouched', async () => {
        const onDropExistingChat = vi.fn();
        const { frame, onParentDrop } = renderFrame({ onDropExistingChat, dropWorkspaceId: 'ws-a' });

        await act(async () => {
            fireEvent.drop(frame, { dataTransfer: dataTransferFor({ [POINTER_MIME]: '{"kind":"other"}' }) });
        });

        expect(onDropExistingChat).not.toHaveBeenCalled();
        expect(onParentDrop).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('commit-chat-drop-rejection')).not.toBeInTheDocument();
    });

    it('shows the drop overlay and claims the drag only for a single-chat payload', () => {
        const { frame } = renderFrame({ onDropExistingChat: vi.fn(), dropWorkspaceId: 'ws-a' });

        const sessionDrag = createEvent.dragOver(frame, { dataTransfer: sessionDataTransfer() });
        fireEvent(frame, sessionDrag);

        expect(sessionDrag.defaultPrevented).toBe(true);
        expect((sessionDrag as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe('copy');
        expect(screen.getByTestId('commit-chat-drop-overlay')).toHaveTextContent('Load this chat into Commit Chat');

        const leave = createEvent.dragLeave(frame);
        Object.defineProperty(leave, 'relatedTarget', { value: document.body });
        fireEvent(frame, leave);
        expect(screen.queryByTestId('commit-chat-drop-overlay')).not.toBeInTheDocument();

        const otherDrag = createEvent.dragOver(frame, { dataTransfer: dataTransferFor({ [POINTER_MIME]: '{}' }) });
        fireEvent(frame, otherDrag);

        expect(otherDrag.defaultPrevented).toBe(false);
        expect(screen.queryByTestId('commit-chat-drop-overlay')).not.toBeInTheDocument();
    });

    it('keeps the overlay while the drag crosses the frame\'s own children', () => {
        const { frame } = renderFrame({ onDropExistingChat: vi.fn(), dropWorkspaceId: 'ws-a' });

        fireEvent.dragOver(frame, { dataTransfer: sessionDataTransfer() });
        expect(screen.getByTestId('commit-chat-drop-overlay')).toBeInTheDocument();

        // jsdom has no DragEvent, so relatedTarget has to be attached by hand.
        const leave = createEvent.dragLeave(frame);
        Object.defineProperty(leave, 'relatedTarget', { value: screen.getByTestId('chat-body') });
        fireEvent(frame, leave);

        expect(screen.getByTestId('commit-chat-drop-overlay')).toBeInTheDocument();
    });

    it('drops the overlay when the drag is cancelled over the frame', () => {
        const { frame } = renderFrame({ onDropExistingChat: vi.fn(), dropWorkspaceId: 'ws-a' });

        fireEvent.dragOver(frame, { dataTransfer: sessionDataTransfer() });
        expect(screen.getByTestId('commit-chat-drop-overlay')).toBeInTheDocument();

        fireEvent.dragEnd(window);
        expect(screen.queryByTestId('commit-chat-drop-overlay')).not.toBeInTheDocument();
    });

    it('is inert for consumers that do not opt in', async () => {
        const { frame, onParentDrop } = renderFrame();

        const dragOver = createEvent.dragOver(frame, { dataTransfer: sessionDataTransfer() });
        fireEvent(frame, dragOver);

        expect(dragOver.defaultPrevented).toBe(false);
        expect(screen.queryByTestId('commit-chat-drop-overlay')).not.toBeInTheDocument();

        await act(async () => {
            fireEvent.drop(frame, { dataTransfer: sessionDataTransfer() });
        });

        expect(onParentDrop).toHaveBeenCalledTimes(1);
    });
});

describe('ReviewChatPlacementFrame dormancy during a drag', () => {
    const SESSION_MIME = 'application/vnd.coc.session-context+json';
    const CARD_RECT = { left: 500, top: 400, right: 900, bottom: 800 };
    const PILL_RECT = { left: 860, top: 760, right: 900, bottom: 800 };
    let originalGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;

    function stubRects(rects: Record<string, { left: number; top: number; right: number; bottom: number }>) {
        Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
            const testId = this.dataset?.testid;
            const rect = (testId && rects[testId]) || { left: 0, top: 0, right: 0, bottom: 0 };
            return {
                ...rect,
                width: rect.right - rect.left,
                height: rect.bottom - rect.top,
                x: rect.left,
                y: rect.top,
                toJSON: () => ({}),
            } as DOMRect;
        };
    }

    /**
     * jsdom implements neither DragEvent nor DataTransfer, and RTL only plumbs
     * `dataTransfer` through — a plain `fireEvent.dragOver` would drop the
     * coordinates the dormant hit test reads. Build the event by hand instead.
     */
    function dispatchDrag(type: 'dragover' | 'dragend', init: { clientX?: number; clientY?: number; types?: string[] } = {}) {
        const event = new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: init.clientX ?? 0,
            clientY: init.clientY ?? 0,
        });
        Object.defineProperty(event, 'dataTransfer', {
            value: { types: init.types ?? [], getData: () => '', dropEffect: 'none' },
        });
        act(() => { window.dispatchEvent(event); });
    }

    function renderLens() {
        render(
            <ReviewChatPlacementFrame
                title="Commit Chat"
                identifier="abc1234"
                presentation="lens"
                onClose={vi.fn()}
                testIdPrefix="commit-chat"
                onDropExistingChat={vi.fn()}
                dropWorkspaceId="ws-a"
            >
                <div data-testid="chat-body">Body</div>
            </ReviewChatPlacementFrame>,
        );
        return {
            lens: screen.getByTestId('commit-chat-lens'),
            card: screen.getByTestId('commit-chat-lens-card'),
        };
    }

    /** Park the cursor far from the lens and let the dormant delay elapse. */
    function goDormant() {
        act(() => {
            // Clear the 24ms hit-test throttle so this move is not swallowed.
            vi.advanceTimersByTime(50);
            fireEvent.mouseMove(window, { clientX: 5, clientY: 5 });
            vi.advanceTimersByTime(700);
        });
    }

    beforeEach(() => {
        originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    });

    it('wakes a ghosted lens from drag coordinates so the drop lands on it', () => {
        stubRects({ 'commit-chat-lens-card': CARD_RECT });
        const { lens, card } = renderLens();

        goDormant();
        expect(lens).toHaveAttribute('data-focused', 'false');
        expect(card.style.pointerEvents).toBe('none');

        vi.advanceTimersByTime(50);
        dispatchDrag('dragover', { clientX: 600, clientY: 500, types: [SESSION_MIME] });

        expect(lens).toHaveAttribute('data-focused', 'true');
        expect(card.style.pointerEvents).toBe('auto');
    });

    it('ignores a drag that carries no CoC payload', () => {
        stubRects({ 'commit-chat-lens-card': CARD_RECT });
        const { lens } = renderLens();

        goDormant();

        vi.advanceTimersByTime(50);
        dispatchDrag('dragover', { clientX: 600, clientY: 500, types: ['text/plain'] });

        expect(lens).toHaveAttribute('data-focused', 'false');
    });

    it('returns to the dormant countdown when the drag ends without a drop', () => {
        stubRects({ 'commit-chat-lens-card': CARD_RECT });
        const { lens } = renderLens();

        goDormant();
        vi.advanceTimersByTime(50);
        dispatchDrag('dragover', { clientX: 600, clientY: 500, types: [SESSION_MIME] });
        expect(lens).toHaveAttribute('data-focused', 'true');

        dispatchDrag('dragend');
        goDormant();

        expect(lens).toHaveAttribute('data-focused', 'false');
    });

    it('aims at the full card instead of the compact pill while a drag is in flight', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            commitChatLensEnabled: true,
            commitChatLensDormantMode: 'pill',
        };
        _resetRuntimeConfig();
        stubRects({ 'commit-chat-lens-card': CARD_RECT, 'commit-chat-lens-dormant-pill': PILL_RECT });
        const { lens } = renderLens();

        goDormant();
        expect(lens).toHaveAttribute('data-focused', 'false');

        // Inside the card but nowhere near the pill: the mouse hit test misses.
        act(() => {
            vi.advanceTimersByTime(50);
            fireEvent.mouseMove(window, { clientX: 520, clientY: 420 });
        });
        expect(lens).toHaveAttribute('data-focused', 'false');

        // The same coordinates during a drag wake it, because the drag forces
        // the card to be the hit target.
        vi.advanceTimersByTime(50);
        dispatchDrag('dragover', { clientX: 520, clientY: 420, types: [SESSION_MIME] });
        expect(lens).toHaveAttribute('data-focused', 'true');
    });

    it('does not collapse a ghost to the pill mid-drag', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            commitChatLensEnabled: true,
            commitChatLensDormantMode: 'ghost-then-pill',
        };
        _resetRuntimeConfig();
        stubRects({ 'commit-chat-lens-card': CARD_RECT, 'commit-chat-lens-dormant-pill': PILL_RECT });
        const { lens } = renderLens();

        goDormant();
        expect(lens).toHaveAttribute('data-focused', 'false');

        // Drag starts far from the lens, then the 15s ghost→pill timer fires.
        vi.advanceTimersByTime(50);
        dispatchDrag('dragover', { clientX: 5, clientY: 5, types: [SESSION_MIME] });
        act(() => { vi.advanceTimersByTime(16000); });

        expect(screen.getByTestId('commit-chat-lens-dormant-pill').style.opacity).toBe('0');

        vi.advanceTimersByTime(50);
        dispatchDrag('dragover', { clientX: 600, clientY: 500, types: [SESSION_MIME] });
        expect(lens).toHaveAttribute('data-focused', 'true');
    });
});

describe('useReviewChatPresentation minimize state', () => {
    it('minimizes and restores lens state without closing the chat', () => {
        const target: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-a', commitHash: 'abc123' };
        writeReviewChatOpen(target, true);

        const { result } = renderHook(() => useReviewChatPresentation({ target }));

        expect(result.current.chatOpen).toBe(true);
        expect(result.current.presentation).toBe('lens');
        expect(result.current.isMinimized).toBe(false);

        act(() => result.current.minimizeChat());

        expect(result.current.chatOpen).toBe(true);
        expect(result.current.isMinimized).toBe(true);
        expect(readReviewChatMinimized(target)).toBe(true);

        act(() => result.current.restoreChat());

        expect(result.current.chatOpen).toBe(true);
        expect(result.current.isMinimized).toBe(false);
        expect(readReviewChatMinimized(target)).toBe(false);
    });

    it('clears minimized state when the chat is closed or pinned', () => {
        const target: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-a', commitHash: 'abc123' };
        writeReviewChatOpen(target, true);

        const { result } = renderHook(() => useReviewChatPresentation({ target }));

        act(() => result.current.minimizeChat());
        act(() => result.current.closeChat());

        expect(result.current.chatOpen).toBe(false);
        expect(result.current.isMinimized).toBe(false);
        expect(readReviewChatMinimized(target)).toBe(false);

        act(() => result.current.toggleChat());
        act(() => result.current.minimizeChat());
        act(() => result.current.pinChat());

        expect(result.current.presentation).toBe('side-panel');
        expect(result.current.isMinimized).toBe(false);
        expect(readReviewChatMinimized(target)).toBe(false);
    });

    it('ignores minimized state outside lens presentation', () => {
        const target: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-a', commitHash: 'abc123' };
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            commitChatLensEnabled: false,
        };

        const { result } = renderHook(() => useReviewChatPresentation({ target }));

        expect(result.current.presentation).toBe('side-panel');

        act(() => result.current.minimizeChat());

        expect(result.current.isMinimized).toBe(false);
        expect(readReviewChatMinimized(target)).toBe(false);
    });

    it('uses the legacy notes open key when Lens is disabled', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            commitChatLensEnabled: false,
        };
        const target: ReviewChatTarget = { type: 'notes', workspaceId: 'ws-a' };
        const legacyOpenStorageKey = 'coc-notes-chat-panel-open-ws-a';
        localStorage.setItem(legacyOpenStorageKey, 'true');

        const { result } = renderHook(() => useReviewChatPresentation({
            target,
            legacyOpenStorageKey,
        }));

        expect(result.current.chatOpen).toBe(true);
        expect(result.current.presentation).toBe('side-panel');

        act(() => result.current.closeChat());

        expect(result.current.chatOpen).toBe(false);
        expect(localStorage.getItem(legacyOpenStorageKey)).toBe('false');
        expect(readReviewChatOpen(target)).toBe(false);
    });

    it('recomputes notes presentation when the Lens runtime config changes', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            commitChatLensEnabled: false,
        };
        const target: ReviewChatTarget = { type: 'notes', workspaceId: 'ws-a' };
        const legacyOpenStorageKey = 'coc-notes-chat-panel-open-ws-a';
        localStorage.setItem(legacyOpenStorageKey, 'true');

        const { result } = renderHook(() => useReviewChatPresentation({
            target,
            legacyOpenStorageKey,
        }));

        expect(result.current.chatOpen).toBe(true);
        expect(result.current.presentation).toBe('side-panel');

        act(() => {
            applyRuntimeConfigPatch({ commitChatLensEnabled: true });
        });

        expect(result.current.chatOpen).toBe(false);
        expect(result.current.presentation).toBe('lens');

        act(() => result.current.toggleChat());

        expect(result.current.chatOpen).toBe(true);
        expect(readReviewChatOpen(target)).toBe(true);
    });

    it('listens to config update events from other dashboard writers', () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            commitChatLensEnabled: true,
        };
        const target: ReviewChatTarget = { type: 'notes', workspaceId: 'ws-a' };

        const { result } = renderHook(() => useReviewChatPresentation({ target }));
        expect(result.current.presentation).toBe('lens');

        act(() => {
            (window as any).__DASHBOARD_CONFIG__ = {
                apiBasePath: '/api',
                wsPath: '/ws',
                commitChatLensEnabled: false,
            };
            _resetRuntimeConfig();
            window.dispatchEvent(new CustomEvent(DASHBOARD_CONFIG_UPDATED_EVENT));
        });

        expect(result.current.presentation).toBe('side-panel');
    });
});
