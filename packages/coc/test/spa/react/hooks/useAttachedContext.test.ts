import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAttachedContext, formatAttachedContext, parseAttachedSessionContextBlocks } from '../../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import { createSessionContextDragPayload } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

describe('useAttachedContext', () => {
    it('starts with empty items', () => {
        const { result } = renderHook(() => useAttachedContext());
        expect(result.current.items).toEqual([]);
    });

    it('adds a context item', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.add(3, 'assistant', 'Some snippet text');
        });
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].kind).toBe('turn');
        expect(result.current.items[0].turnIndex).toBe(3);
        expect(result.current.items[0].role).toBe('assistant');
        expect(result.current.items[0].snippet).toBe('Some snippet text');
    });

    it('adds a session context item', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.addSession({
                kind: 'coc.session-context',
                version: 1,
                sourceWorkspaceId: 'ws-1',
                sourceProcessId: 'source-process-123456',
                title: 'Source chat',
                status: 'completed',
                lastActivityAt: '2026-01-01T00:00:00.000Z',
            });
        });
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0]).toMatchObject({
            kind: 'session',
            sourceWorkspaceId: 'ws-1',
            sourceProcessId: 'source-process-123456',
            title: 'Source chat',
            status: 'completed',
            lastActivityAt: '2026-01-01T00:00:00.000Z',
        });
        expect(result.current.items[0].preview).toContain('source-p…3456');
    });

    it('does not persist last message preview content from session drag sources', () => {
        const payload = createSessionContextDragPayload({
            id: 'source-process-123456',
            workspaceId: 'ws-1',
            status: 'completed',
            lastMessagePreview: 'Assistant turn with sensitive transcript content',
            promptPreview: 'Original prompt preview',
            startTime: '2026-01-01T00:00:00Z',
        }, { activeWorkspaceId: 'ws-1', idSource: 'process' });
        const { result } = renderHook(() => useAttachedContext());

        expect(payload).not.toBeNull();
        if (!payload) throw new Error('Expected safe session context drag payload');

        act(() => {
            result.current.addSession(payload);
        });

        const formatted = formatAttachedContext(result.current.items);
        expect(formatted).toContain('<title>Original prompt preview</title>');
        expect(formatted).not.toContain('Assistant turn with sensitive transcript content');
    });

    it('generates a truncated preview', () => {
        const { result } = renderHook(() => useAttachedContext());
        const longText = 'x'.repeat(200);
        act(() => {
            result.current.add(1, 'user', longText);
        });
        expect(result.current.items[0].preview.length).toBeLessThanOrEqual(101); // 100 + ellipsis char
        expect(result.current.items[0].preview.endsWith('…')).toBe(true);
    });

    it('preview keeps short text intact', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.add(0, 'user', 'Short text');
        });
        expect(result.current.items[0].preview).toBe('Short text');
    });

    it('collapses newlines in preview', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.add(0, 'assistant', 'Line one\nLine two\nLine three');
        });
        expect(result.current.items[0].preview).toBe('Line one Line two Line three');
    });

    it('adds multiple items', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.add(1, 'user', 'First');
            result.current.add(2, 'assistant', 'Second');
        });
        expect(result.current.items).toHaveLength(2);
    });

    it('removes an item by id', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.add(1, 'user', 'Keep');
            result.current.add(2, 'assistant', 'Remove');
        });
        const idToRemove = result.current.items[1].id;
        act(() => {
            result.current.remove(idToRemove);
        });
        expect(result.current.items).toHaveLength(1);
        expect(result.current.items[0].snippet).toBe('Keep');
    });

    it('clears all items', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.add(1, 'user', 'One');
            result.current.add(2, 'assistant', 'Two');
        });
        act(() => {
            result.current.clear();
        });
        expect(result.current.items).toEqual([]);
    });

    it('getItems returns current items via ref', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.add(5, 'assistant', 'Ref test');
        });
        const items = result.current.getItems();
        expect(items).toHaveLength(1);
        expect(items[0].turnIndex).toBe(5);
    });

    it('remove with non-existent id is a no-op', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.add(1, 'user', 'Stays');
        });
        act(() => {
            result.current.remove('nonexistent-id');
        });
        expect(result.current.items).toHaveLength(1);
    });
});

describe('formatAttachedContext', () => {
    it('returns empty string for empty items', () => {
        expect(formatAttachedContext([])).toBe('');
    });

    it('formats a single item', () => {
        const result = formatAttachedContext([{
            kind: 'turn',
            id: 'ctx-1',
            turnIndex: 3,
            role: 'assistant',
            snippet: 'Hello world',
            preview: 'Hello world',
        }]);
        expect(result).toBe(
            '<context from="assistant" turn="3">\nHello world\n</context>\n\n'
        );
    });

    it('formats multiple items separated by blank lines', () => {
        const result = formatAttachedContext([
            { kind: 'turn', id: 'ctx-1', turnIndex: 1, role: 'user', snippet: 'First', preview: 'First' },
            { kind: 'turn', id: 'ctx-2', turnIndex: 3, role: 'assistant', snippet: 'Second', preview: 'Second' },
        ]);
        expect(result).toContain('<context from="user" turn="1">');
        expect(result).toContain('<context from="assistant" turn="3">');
        // Two context blocks separated by \n\n, with final \n\n
        const blocks = result.trim().split('\n\n');
        expect(blocks).toHaveLength(2);
    });

    it('formats a pointer-only session context block', () => {
        const result = formatAttachedContext([{
            kind: 'session',
            id: 'ctx-session',
            sourceWorkspaceId: 'ws-1',
            sourceProcessId: 'source-process-123456',
            title: 'Debug <source> & inspect',
            status: 'failed',
            lastActivityAt: '2026-01-01T00:00:00.000Z',
            preview: 'Debug source',
        }]);

        expect(result).toContain('<attached_session_context version="1">');
        expect(result).toContain('workspace_id="ws-1"');
        expect(result).toContain('process_id="source-process-123456"');
        expect(result).toContain('status="failed"');
        expect(result).toContain('last_activity_at="2026-01-01T00:00:00.000Z"');
        expect(result).toContain('<title>Debug &lt;source&gt; &amp; inspect</title>');
        expect(result).toContain('retrieve and read this source conversation by process ID');
        expect(result).not.toContain('transcript');
    });
});

describe('parseAttachedSessionContextBlocks', () => {
    it('extracts session context blocks and returns the remaining message', () => {
        const content = [
            '<attached_session_context version="1">',
            '<source workspace_id="ws-1" process_id="source-process-123456" status="failed" last_activity_at="2026-01-01T00:00:00.000Z">',
            '<title>Debug &lt;source&gt; &amp; inspect</title>',
            '<instruction>Before answering, retrieve and read this source conversation by process ID using the available conversation retrieval tool.</instruction>',
            '</source>',
            '</attached_session_context>',
            '',
            'Continue debugging.',
        ].join('\n');

        const result = parseAttachedSessionContextBlocks(content);

        expect(result.sessionContexts).toHaveLength(1);
        expect(result.sessionContexts[0]).toMatchObject({
            sourceWorkspaceId: 'ws-1',
            sourceProcessId: 'source-process-123456',
            status: 'failed',
            lastActivityAt: '2026-01-01T00:00:00.000Z',
            title: 'Debug <source> & inspect',
        });
        expect(result.sessionContexts[0].rawBlock).toContain('<attached_session_context version="1">');
        expect(result.remainingContent).toBe('Continue debugging.');
    });

    it('leaves ordinary messages unchanged', () => {
        const content = 'No attached session context here.';
        expect(parseAttachedSessionContextBlocks(content)).toEqual({
            sessionContexts: [],
            remainingContent: content,
        });
    });
});
