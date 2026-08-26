/**
 * composerInsert — the cross-tree bridge the dock's Notes panel uses to drop a
 * note reference into the chat composer.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import {
    COMPOSER_INSERT_EVENT,
    appendComposerText,
    dispatchComposerInsert,
    useComposerInsertListener,
} from '../../../../src/server/spa/client/react/features/chat/composerInsert';

describe('appendComposerText', () => {
    it('returns the addition when the draft is empty', () => {
        expect(appendComposerText('', 'note')).toBe('note');
    });

    it('separates an existing draft from the addition with a blank line', () => {
        expect(appendComposerText('hello', 'note')).toBe('hello\n\nnote');
    });

    it('normalises trailing whitespace so the gap is exactly one blank line', () => {
        expect(appendComposerText('hello\n\n\n', 'note')).toBe('hello\n\nnote');
        expect(appendComposerText('   ', 'note')).toBe('note');
    });

    it('leaves the draft untouched for a blank addition', () => {
        expect(appendComposerText('hello', '   ')).toBe('hello');
    });
});

/** Minimal stand-in for a composer host (ChatDetail / NewChatArea). */
function Composer({ workspaceId }: { workspaceId?: string }) {
    const [text, setText] = useState('');
    useComposerInsertListener(workspaceId, setText);
    return <div data-testid="composer">{text}</div>;
}

describe('useComposerInsertListener', () => {
    it('appends dispatched text to the composer draft', () => {
        render(<Composer workspaceId="ws1" />);
        act(() => dispatchComposerInsert({ workspaceId: 'ws1', text: 'first' }));
        act(() => dispatchComposerInsert({ workspaceId: 'ws1', text: 'second' }));
        expect(screen.getByTestId('composer').textContent).toBe('first\n\nsecond');
    });

    it('ignores text addressed to another workspace', () => {
        render(<Composer workspaceId="ws1" />);
        act(() => dispatchComposerInsert({ workspaceId: 'ws2', text: 'nope' }));
        expect(screen.getByTestId('composer').textContent).toBe('');
    });

    it('accepts unaddressed text (no workspaceId in the event)', () => {
        render(<Composer workspaceId="ws1" />);
        act(() => dispatchComposerInsert({ text: 'broadcast' }));
        expect(screen.getByTestId('composer').textContent).toBe('broadcast');
    });

    it('accepts addressed text when the composer itself has no workspace', () => {
        render(<Composer />);
        act(() => dispatchComposerInsert({ workspaceId: 'ws1', text: 'anything' }));
        expect(screen.getByTestId('composer').textContent).toBe('anything');
    });

    it('never dispatches a blank insert', () => {
        const spy = vi.fn();
        window.addEventListener(COMPOSER_INSERT_EVENT, spy);
        dispatchComposerInsert({ text: '   ' });
        window.removeEventListener(COMPOSER_INSERT_EVENT, spy);
        expect(spy).not.toHaveBeenCalled();
    });

    it('ignores malformed events instead of throwing', () => {
        render(<Composer workspaceId="ws1" />);
        act(() => {
            window.dispatchEvent(new CustomEvent(COMPOSER_INSERT_EVENT));
            window.dispatchEvent(new CustomEvent(COMPOSER_INSERT_EVENT, { detail: { text: 42 } }));
        });
        expect(screen.getByTestId('composer').textContent).toBe('');
    });

    it('unsubscribes on unmount (no stale composer keeps collecting text)', () => {
        const { unmount } = render(<Composer workspaceId="ws1" />);
        unmount();
        // Would throw a React "update on unmounted component" path if still bound.
        act(() => dispatchComposerInsert({ workspaceId: 'ws1', text: 'after' }));
        expect(screen.queryByTestId('composer')).toBeNull();
    });
});
