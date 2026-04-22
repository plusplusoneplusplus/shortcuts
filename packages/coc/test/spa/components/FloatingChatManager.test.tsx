/**
 * Tests for FloatingChatsContext — floatChat, unfloatChat, isFloating.
 *
 * FloatingChatManager itself renders FloatingDialog + FloatingChatContent, which
 * have heavy dependencies. We test the context API directly via the provider.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { type ReactNode } from 'react';
import { FloatingChatsProvider, useFloatingChats, type FloatingChatEntry } from '../../../src/server/spa/client/react/contexts/FloatingChatsContext';

// ── Helpers ──────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: ReactNode }) {
    return <FloatingChatsProvider>{children}</FloatingChatsProvider>;
}

function makeEntry(taskId = 'task-1'): FloatingChatEntry {
    return { taskId, workspaceId: 'ws-1', title: 'My Chat', status: 'running' };
}

function FloatConsumer({ taskId }: { taskId: string }) {
    const { floatingChats, floatChat, unfloatChat, isFloating } = useFloatingChats();
    return (
        <div>
            <span data-testid="count">{floatingChats.size}</span>
            <span data-testid="is-floating">{String(isFloating(taskId))}</span>
            <button data-testid="btn-float" onClick={() => floatChat(makeEntry(taskId))}>Float</button>
            <button data-testid="btn-unfloat" onClick={() => unfloatChat(taskId)}>Unfloat</button>
        </div>
    );
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('FloatingChatsContext', () => {
    it('starts with empty floatingChats map', () => {
        render(<Wrapper><FloatConsumer taskId="t1" /></Wrapper>);
        expect(screen.getByTestId('count').textContent).toBe('0');
    });

    it('floatChat adds entry to the map', async () => {
        render(<Wrapper><FloatConsumer taskId="t1" /></Wrapper>);
        act(() => { screen.getByTestId('btn-float').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('count').textContent).toBe('1');
        });
    });

    it('isFloating returns true after floatChat', async () => {
        render(<Wrapper><FloatConsumer taskId="t1" /></Wrapper>);
        act(() => { screen.getByTestId('btn-float').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('is-floating').textContent).toBe('true');
        });
    });

    it('unfloatChat removes entry from the map', async () => {
        render(<Wrapper><FloatConsumer taskId="t1" /></Wrapper>);
        act(() => { screen.getByTestId('btn-float').click(); });
        await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
        act(() => { screen.getByTestId('btn-unfloat').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('count').textContent).toBe('0');
        });
    });

    it('isFloating returns false after unfloatChat', async () => {
        render(<Wrapper><FloatConsumer taskId="t1" /></Wrapper>);
        act(() => { screen.getByTestId('btn-float').click(); });
        await waitFor(() => expect(screen.getByTestId('is-floating').textContent).toBe('true'));
        act(() => { screen.getByTestId('btn-unfloat').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('is-floating').textContent).toBe('false');
        });
    });

    it('unfloatChat is a no-op when entry does not exist', async () => {
        render(<Wrapper><FloatConsumer taskId="nonexistent" /></Wrapper>);
        act(() => { screen.getByTestId('btn-unfloat').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('count').textContent).toBe('0');
        });
    });

    it('floatChat for same taskId overwrites the previous entry', async () => {
        function FloatTwice() {
            const { floatingChats, floatChat } = useFloatingChats();
            return (
                <div>
                    <span data-testid="count">{floatingChats.size}</span>
                    <span data-testid="title">{floatingChats.get('t1')?.title ?? ''}</span>
                    <button data-testid="float-1" onClick={() => floatChat({ taskId: 't1', title: 'First', status: 'running' })}>First</button>
                    <button data-testid="float-2" onClick={() => floatChat({ taskId: 't1', title: 'Updated', status: 'completed' })}>Second</button>
                </div>
            );
        }
        render(<Wrapper><FloatTwice /></Wrapper>);
        act(() => { screen.getByTestId('float-1').click(); });
        await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
        act(() => { screen.getByTestId('float-2').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('count').textContent).toBe('1');
            expect(screen.getByTestId('title').textContent).toBe('Updated');
        });
    });

    it('multiple different taskIds create multiple entries', async () => {
        function MultiFloat() {
            const { floatingChats, floatChat } = useFloatingChats();
            return (
                <div>
                    <span data-testid="count">{floatingChats.size}</span>
                    <button data-testid="float-a" onClick={() => floatChat({ taskId: 'a', title: 'A', status: 'running' })}>A</button>
                    <button data-testid="float-b" onClick={() => floatChat({ taskId: 'b', title: 'B', status: 'running' })}>B</button>
                    <button data-testid="float-c" onClick={() => floatChat({ taskId: 'c', title: 'C', status: 'running' })}>C</button>
                </div>
            );
        }
        render(<Wrapper><MultiFloat /></Wrapper>);
        act(() => { screen.getByTestId('float-a').click(); });
        act(() => { screen.getByTestId('float-b').click(); });
        act(() => { screen.getByTestId('float-c').click(); });
        await waitFor(() => {
            expect(screen.getByTestId('count').textContent).toBe('3');
        });
    });
});
