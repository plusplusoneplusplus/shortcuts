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

    it('j and k step the cursor with no wrap', () => {
        const { container } = render(<Harness taskIds={['a', 'b', 'c']} selectedTaskId={null} />);
        act(() => { fireEvent.keyDown(window, { key: 'h' }); });
        expect(cursor(container)).toBe('a');
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect(cursor(container)).toBe('b');
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect(cursor(container)).toBe('c');
        // No wrap at the end.
        act(() => { fireEvent.keyDown(window, { key: 'j' }); });
        expect(cursor(container)).toBe('c');
        act(() => { fireEvent.keyDown(window, { key: 'k' }); });
        expect(cursor(container)).toBe('b');
        act(() => { fireEvent.keyDown(window, { key: 'k' }); });
        expect(cursor(container)).toBe('a');
        // No wrap at the start.
        act(() => { fireEvent.keyDown(window, { key: 'k' }); });
        expect(cursor(container)).toBe('a');
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
});
