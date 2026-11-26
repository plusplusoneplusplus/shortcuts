import { describe, expect, it } from 'vitest';
import { recordChatSelection } from '../../../../src/server/spa/client/react/layout/chatSelectionMru';

describe('chat selection MRU', () => {
    it('records the first selection without a previous chat', () => {
        const history = recordChatSelection(new Map(), 'workspace', 'A');
        expect(history.get('workspace')).toEqual({ current: 'A', previous: null });
    });

    it('keeps only the current and previous chats and swaps them on a toggle', () => {
        const first = recordChatSelection(new Map(), 'workspace', 'A');
        const second = recordChatSelection(first, 'workspace', 'B');
        expect(second.get('workspace')).toEqual({ current: 'B', previous: 'A' });
        const toggled = recordChatSelection(second, 'workspace', 'A');
        expect(toggled.get('workspace')).toEqual({ current: 'A', previous: 'B' });
        expect(recordChatSelection(toggled, 'workspace', 'C').get('workspace'))
            .toEqual({ current: 'C', previous: 'A' });
        expect(first.get('workspace')).toEqual({ current: 'A', previous: null });
    });

    it('leaves history unchanged when selecting the current chat again', () => {
        const history = recordChatSelection(recordChatSelection(new Map(), 'workspace', 'A'), 'workspace', 'B');
        expect(recordChatSelection(history, 'workspace', 'B')).toBe(history);
    });

    it('isolates workspace selection ids, including clones on another server', () => {
        const local = recordChatSelection(new Map(), 'workspace', 'A');
        const remote = recordChatSelection(local, 'remote:server:workspace', 'A');
        const history = recordChatSelection(remote, 'workspace', 'B');
        expect(history.get('workspace')).toEqual({ current: 'B', previous: 'A' });
        expect(history.get('remote:server:workspace')).toEqual({ current: 'A', previous: null });
    });

    it('preserves the last viewed chats when selection is cleared', () => {
        const history = recordChatSelection(new Map(), 'workspace', 'A');
        expect(recordChatSelection(history, 'workspace', null)).toBe(history);
        expect(recordChatSelection(history, 'workspace', undefined)).toBe(history);
    });
});
