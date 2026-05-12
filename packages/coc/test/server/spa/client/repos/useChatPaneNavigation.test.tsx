/**
 * useChatPaneNavigation tests — vim-style h/l pane navigation between the
 * chat list and chat detail panes, plus j/k/Enter/o/i list-pane shortcuts.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { useChatPaneNavigation } from '../../../../../src/server/spa/client/react/features/chat/hooks/useChatPaneNavigation';

// Mock useDisplaySettings so we control vimNavigationEnabled per test.
let mockVimEnabled = true;
vi.mock('../../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({
        showReportIntent: false,
        toolCompactness: 3 as const,
        taskCardDensity: 'dense' as const,
        historyGrouping: true,
        groupSingleLineMessages: true,
        terminalEnabled: true,
        notesEnabled: true,
        myWorkEnabled: false,
        myLifeEnabled: false,
        scratchpadEnabled: false,
        scratchpadLayout: 'vertical' as const,
        workflowsEnabled: false,
        pullRequestsEnabled: false,
        vimNavigationEnabled: mockVimEnabled,
    }),
    invalidateDisplaySettings: () => {},
}));

interface HarnessProps {
    taskIds: string[];
    selectedTaskId?: string | null;
    enabled?: boolean;
    isMobile?: boolean;
    mobileShowDetail?: boolean;
    withInput?: boolean;
}

function Harness({
    taskIds,
    selectedTaskId = null,
    enabled = true,
    isMobile = false,
    mobileShowDetail = true,
    withInput = false,
}: HarnessProps) {
    const listContainerRef = useRef<HTMLDivElement>(null);
    const detailContainerRef = useRef<HTMLDivElement>(null);
    const inputFocus = useRef(vi.fn()).current;
    const inputRef = useRef<{ focus: () => void } | null>({ focus: inputFocus });
    const onSelectTask = useRef(vi.fn()).current;
    const onEnterDetail = useRef(vi.fn()).current;
    const onEnterList = useRef(vi.fn()).current;

    (window as any).__inputFocus = inputFocus;
    (window as any).__onSelectTask = onSelectTask;
    (window as any).__onEnterDetail = onEnterDetail;
    (window as any).__onEnterList = onEnterList;

    const { focusedPane, cursorTaskId } = useChatPaneNavigation({
        listContainerRef,
        detailContainerRef,
        inputRef,
        selectedTaskId,
        onSelectTask,
        enabled,
        isMobile,
        mobileShowDetail,
        onEnterDetail,
        onEnterList,
    });

    (window as any).__focusedPane = focusedPane;
    (window as any).__cursorTaskId = cursorTaskId;

    return (
        <div>
            <div ref={listContainerRef} tabIndex={-1} data-testid="list">
                {taskIds.map(id => (
                    <div key={id} data-task-id={id} data-testid={`card-${id}`}>{id}</div>
                ))}
            </div>
            <div ref={detailContainerRef} tabIndex={-1} data-testid="detail">
                {withInput && <textarea data-testid="input" defaultValue="" />}
            </div>
            <div data-testid="state-pane">{focusedPane}</div>
            <div data-testid="state-cursor">{cursorTaskId ?? 'none'}</div>
        </div>
    );
}

beforeEach(() => {
    mockVimEnabled = true;
    Element.prototype.scrollIntoView = vi.fn();
});

function pane(container: HTMLElement): string {
    return container.querySelector('[data-testid="state-pane"]')!.textContent ?? '';
}
function cursor(container: HTMLElement): string {
    return container.querySelector('[data-testid="state-cursor"]')!.textContent ?? '';
}

describe('useChatPaneNavigation', () => {
    it('defaults focused pane to detail when a task is selected, list otherwise', () => {
        const { container, rerender } = render(<Harness taskIds={['a']} selectedTaskId="a" />);
        expect(pane(container)).toBe('detail');
        rerender(<Harness taskIds={['a']} selectedTaskId={null} />);
        // Note: hook initializes from selectedTaskId at first mount; rerender does
        // not re-run useState initializer, so this just sanity-checks no crash.
        expect(['list', 'detail']).toContain(pane(container));
    });

    it('h moves focus to list and sets cursor to selectedTaskId', () => {
        const { container } = render(<Harness taskIds={['a', 'b', 'c']} selectedTaskId="b" />);
        const detail = container.querySelector('[data-testid="detail"]') as HTMLElement;
        detail.focus();
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        expect(pane(container)).toBe('list');
        expect(cursor(container)).toBe('b');
    });

    it('h sets cursor to first card when nothing is selected', () => {
        const { container } = render(<Harness taskIds={['a', 'b', 'c']} selectedTaskId={null} />);
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        expect(pane(container)).toBe('list');
        expect(cursor(container)).toBe('a');
    });

    it('l moves focus to detail', () => {
        const { container } = render(<Harness taskIds={['a']} selectedTaskId="a" />);
        const list = container.querySelector('[data-testid="list"]') as HTMLElement;
        list.focus();
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        expect(pane(container)).toBe('list');
        act(() => { fireEvent.keyDown(window, { key: 'l' }); });
        expect(pane(container)).toBe('detail');
    });

    it('j and k step the cursor with no wrap and open the chat immediately', () => {
        const { container } = render(<Harness taskIds={['a', 'b', 'c']} selectedTaskId={null} />);
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        expect(cursor(container)).toBe('a');
        const onSelect = (window as any).__onSelectTask as ReturnType<typeof vi.fn>;
        onSelect.mockClear();
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect(cursor(container)).toBe('b');
        expect(onSelect).toHaveBeenLastCalledWith('b');
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect(cursor(container)).toBe('c');
        expect(onSelect).toHaveBeenLastCalledWith('c');
        // No wrap at the end: no further select call.
        const callsBefore = onSelect.mock.calls.length;
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect(cursor(container)).toBe('c');
        expect(onSelect.mock.calls.length).toBe(callsBefore);
        act(() => { fireEvent.keyDown(window, { key: 'k' }); });
        expect(cursor(container)).toBe('b');
        expect(onSelect).toHaveBeenLastCalledWith('b');
        act(() => { fireEvent.keyDown(window, { key: 'k' }); });
        expect(cursor(container)).toBe('a');
        expect(onSelect).toHaveBeenLastCalledWith('a');
        // No wrap at the start.
        const callsAtStart = onSelect.mock.calls.length;
        act(() => { fireEvent.keyDown(window, { key: 'k' }); });
        expect(cursor(container)).toBe('a');
        expect(onSelect.mock.calls.length).toBe(callsAtStart);
    });

    it('Enter calls onSelectTask with the cursor id', () => {
        render(<Harness taskIds={['a', 'b', 'c']} selectedTaskId={null} />);
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
        expect((window as any).__onSelectTask).toHaveBeenCalledWith('b');
    });

    it('o calls onSelectTask with the cursor id', () => {
        render(<Harness taskIds={['a']} selectedTaskId={null} />);
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        act(() => { fireEvent.keyDown(window, { key: 'o' }); });
        expect((window as any).__onSelectTask).toHaveBeenCalledWith('a');
    });

    it('i focuses the chat input', () => {
        render(<Harness taskIds={['a']} selectedTaskId="a" withInput />);
        act(() => { fireEvent.keyDown(window, { key: 'i' }); });
        expect((window as any).__inputFocus).toHaveBeenCalled();
    });

    it('does nothing when active element is editable', () => {
        const { container } = render(<Harness taskIds={['a', 'b']} selectedTaskId="a" withInput />);
        const input = container.querySelector('[data-testid="input"]') as HTMLTextAreaElement;
        input.focus();
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        // pane should not have switched to list
        expect(pane(container)).toBe('detail');
    });

    it('ignores h/l when ctrl/meta/alt held', () => {
        const { container } = render(<Harness taskIds={['a']} selectedTaskId="a" />);
        act(() => { fireEvent.keyDown(window, { key: 'h', ctrlKey: true }); });
        act(() => { fireEvent.keyDown(window, { key: 'h', metaKey: true }); });
        act(() => { fireEvent.keyDown(window, { key: 'h', altKey: true }); });
        expect(pane(container)).toBe('detail');
    });

    it('ignores keys during IME composition', () => {
        const { container } = render(<Harness taskIds={['a', 'b']} selectedTaskId={null} />);
        act(() => { fireEvent.keyDown(window, { key: 'h', isComposing: true } as any); });
        // Cursor should not have been set
        expect(cursor(container)).toBe('none');
    });

    it('does nothing when enabled is false', () => {
        const { container } = render(<Harness taskIds={['a', 'b']} selectedTaskId={null} enabled={false} />);
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        expect(cursor(container)).toBe('none');
    });

    it('mobile: l no-ops when no task selected', () => {
        const { container } = render(
            <Harness taskIds={['a']} selectedTaskId={null} isMobile mobileShowDetail={false} />,
        );
        act(() => { fireEvent.keyDown(window, { key: 'l' }); });
        expect((window as any).__onEnterDetail).not.toHaveBeenCalled();
    });

    it('mobile: l calls onEnterDetail when a task is selected', () => {
        render(
            <Harness taskIds={['a']} selectedTaskId="a" isMobile mobileShowDetail={false} />,
        );
        act(() => { fireEvent.keyDown(window, { key: 'l' }); });
        expect((window as any).__onEnterDetail).toHaveBeenCalled();
    });

    it('mobile: h calls onEnterList when detail is showing', () => {
        const { container } = render(
            <Harness taskIds={['a']} selectedTaskId="a" isMobile mobileShowDetail />,
        );
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        expect(pane(container)).toBe('list');
        expect((window as any).__onEnterList).toHaveBeenCalled();
    });

    it('mobile: h is a no-op when already on the list view', () => {
        render(
            <Harness taskIds={['a']} selectedTaskId={null} isMobile mobileShowDetail={false} />,
        );
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        expect((window as any).__onEnterList).not.toHaveBeenCalled();
    });

    it('j/k do nothing when focused pane is detail', () => {
        const { container } = render(<Harness taskIds={['a', 'b']} selectedTaskId="a" />);
        const detail = container.querySelector('[data-testid="detail"]') as HTMLElement;
        detail.focus();
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect(cursor(container)).toBe('none');
    });

    it('Enter does nothing when no cursor is set', () => {
        render(<Harness taskIds={['a']} selectedTaskId={null} />);
        // focus the list directly (no h pressed) — cursor remains null.
        const list = (document.querySelector('[data-testid="list"]') as HTMLElement);
        list.focus();
        act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
        expect((window as any).__onSelectTask).not.toHaveBeenCalled();
    });

    it('Enter falls back to selectedTaskId when no cursor is set (re-open after Esc)', () => {
        render(<Harness taskIds={['a', 'b']} selectedTaskId="b" />);
        const list = (document.querySelector('[data-testid="list"]') as HTMLElement);
        list.focus();
        act(() => { fireEvent.keyDown(window, { key: 'Enter' }); });
        expect((window as any).__onSelectTask).toHaveBeenCalledWith('b');
    });

    it('o falls back to selectedTaskId when no cursor is set', () => {
        render(<Harness taskIds={['a', 'b']} selectedTaskId="a" />);
        const list = (document.querySelector('[data-testid="list"]') as HTMLElement);
        list.focus();
        act(() => { fireEvent.keyDown(window, { key: 'o' }); });
        expect((window as any).__onSelectTask).toHaveBeenCalledWith('a');
    });
});

describe('useChatPaneNavigation — vimNavigationEnabled flag', () => {
    it('returns null focusedPane and cursorTaskId when vimNavigationEnabled is false', () => {
        mockVimEnabled = false;
        const { container } = render(<Harness taskIds={['a', 'b']} selectedTaskId="a" />);
        // focusedPane should be null (rendered as empty string) and cursor 'none'.
        expect(pane(container)).toBe('');
        expect(cursor(container)).toBe('none');
    });

    it('does not handle h/l/j/k/i/Enter/o keys when vimNavigationEnabled is false', () => {
        mockVimEnabled = false;
        const { container } = render(<Harness taskIds={['a', 'b', 'c']} selectedTaskId={null} withInput />);
        const onSelect = (window as any).__onSelectTask as ReturnType<typeof vi.fn>;
        const inputFocus = (window as any).__inputFocus as ReturnType<typeof vi.fn>;
        onSelect.mockClear();
        inputFocus.mockClear();
        for (const key of ['h', 'l', 'j', 'k', 'i', 'Enter', 'o']) {
            act(() => { fireEvent.keyDown(window, { key }); });
        }
        expect(pane(container)).toBe('');
        expect(cursor(container)).toBe('none');
        expect(onSelect).not.toHaveBeenCalled();
        expect(inputFocus).not.toHaveBeenCalled();
    });
});

describe('useChatPaneNavigation — list traversal edge cases', () => {
    function HarnessWithMixedDom({ selectedTaskId = null as string | null }) {
        const listContainerRef = useRef<HTMLDivElement>(null);
        const detailContainerRef = useRef<HTMLDivElement>(null);
        const onSelectTask = useRef(vi.fn()).current;
        (window as any).__onSelectTask = onSelectTask;

        const { cursorTaskId } = useChatPaneNavigation({
            listContainerRef,
            detailContainerRef,
            selectedTaskId,
            onSelectTask,
            enabled: true,
        });
        (window as any).__cursorTaskId = cursorTaskId;

        return (
            <div>
                <div ref={listContainerRef} tabIndex={-1} data-testid="list">
                    <div className="section-header">Pinned</div>
                    <div data-task-id="a">a (pinned)</div>
                    <div className="section-header">Today</div>
                    <div data-task-id="a">a (today, dup)</div>
                    <div data-task-id="b">b</div>
                    <div className="section-header">Older</div>
                    <div data-task-id="c">c</div>
                </div>
                <div ref={detailContainerRef} tabIndex={-1} data-testid="detail" />
                <div data-testid="state-cursor">{cursorTaskId ?? 'none'}</div>
            </div>
        );
    }

    it('skips section headers and de-duplicates by data-task-id (visual top-down)', () => {
        const { container } = render(<HarnessWithMixedDom />);
        const list = container.querySelector('[data-testid="list"]') as HTMLElement;
        list.focus();
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        expect(cursor(container)).toBe('a');
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        // Should advance to 'b', not the second 'a' duplicate.
        expect(cursor(container)).toBe('b');
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect(cursor(container)).toBe('c');
        // No wrap.
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect(cursor(container)).toBe('c');
    });

    it('j is a no-op when the list has no [data-task-id] children', () => {
        function EmptyHarness() {
            const listContainerRef = useRef<HTMLDivElement>(null);
            const detailContainerRef = useRef<HTMLDivElement>(null);
            const onSelectTask = useRef(vi.fn()).current;
            (window as any).__onSelectTask = onSelectTask;
            useChatPaneNavigation({
                listContainerRef,
                detailContainerRef,
                selectedTaskId: null,
                onSelectTask,
                enabled: true,
            });
            return (
                <div>
                    <div ref={listContainerRef} tabIndex={-1} data-testid="list">
                        <div className="section-header">Empty</div>
                    </div>
                    <div ref={detailContainerRef} tabIndex={-1} data-testid="detail" />
                </div>
            );
        }
        const { container } = render(<EmptyHarness />);
        const list = container.querySelector('[data-testid="list"]') as HTMLElement;
        list.focus();
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect((window as any).__onSelectTask).not.toHaveBeenCalled();
    });
});
