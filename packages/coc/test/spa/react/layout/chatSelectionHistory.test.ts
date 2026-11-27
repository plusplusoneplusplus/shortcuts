import { describe, expect, it } from 'vitest';
import { moveChatSelection, recordChatSelection } from '../../../../src/server/spa/client/react/layout/chatSelectionHistory';

function seed() {
    let history = recordChatSelection(new Map(), 'workspace', 'A');
    history = recordChatSelection(history, 'workspace', 'B');
    return recordChatSelection(history, 'workspace', 'C');
}
const available = () => true;

describe('chat selection history', () => {
    it('records the first selection', () => {
        expect(recordChatSelection(new Map(), 'workspace', 'A').get('workspace'))
            .toEqual({ entries: ['A'], index: 0 });
    });

    it('replays multiple steps in both directions without appending or mutating history', () => {
        const original = seed();
        let history = original;
        for (const chat of ['B', 'A']) {
            history = moveChatSelection(history, 'workspace', -1, available);
            expect(recordChatSelection(history, 'workspace', chat)).toBe(history);
            const entry = history.get('workspace')!;
            expect(entry.entries[entry.index]).toBe(chat);
        }
        expect(moveChatSelection(history, 'workspace', -1, available)).toBe(history);
        for (const chat of ['B', 'C']) {
            history = moveChatSelection(history, 'workspace', 1, available);
            expect(recordChatSelection(history, 'workspace', chat)).toBe(history);
        }
        expect(moveChatSelection(history, 'workspace', 1, available)).toBe(history);
        expect(original.get('workspace')).toEqual({ entries: ['A', 'B', 'C'], index: 2 });
    });

    it('truncates forward history after a new selection and retains repeat visits', () => {
        const back = moveChatSelection(seed(), 'workspace', -1, available);
        const branched = recordChatSelection(back, 'workspace', 'D');
        expect(branched.get('workspace')).toEqual({ entries: ['A', 'B', 'D'], index: 2 });
        expect(moveChatSelection(branched, 'workspace', 1, available)).toBe(branched);
        expect(recordChatSelection(branched, 'workspace', 'A').get('workspace'))
            .toEqual({ entries: ['A', 'B', 'D', 'A'], index: 3 });
    });

    it('skips unavailable entries in either direction without moving when none qualify', () => {
        const original = seed();
        const back = moveChatSelection(original, 'workspace', -1, id => id !== 'B');
        expect(back.get('workspace')?.index).toBe(0);
        expect(moveChatSelection(back, 'workspace', 1, id => id !== 'B').get('workspace')?.index).toBe(2);
        expect(moveChatSelection(original, 'workspace', -1, () => false)).toBe(original);
        expect(moveChatSelection(original, 'missing', -1, available)).toBe(original);
    });

    it('isolates workspace selection ids, including clones on another server', () => {
        const local = seed();
        const remote = recordChatSelection(local, 'remote:server:workspace', 'X');
        const history = moveChatSelection(remote, 'workspace', -1, available);
        expect(history.get('workspace')?.index).toBe(1);
        expect(history.get('remote:server:workspace')).toEqual({ entries: ['X'], index: 0 });
        expect(moveChatSelection(history, 'remote:server:workspace', -1, available)).toBe(history);
    });

    it('preserves both directions when selection is cleared or reselected', () => {
        const history = moveChatSelection(seed(), 'workspace', -1, available);
        for (const chat of [null, undefined, 'B']) {
            expect(recordChatSelection(history, 'workspace', chat)).toBe(history);
        }
    });

    it('bounds history to the most recent 50 visits', () => {
        let history = seed();
        for (let i = 0; i < 60; i++) history = recordChatSelection(history, 'workspace', String(i));
        expect(history.get('workspace')).toEqual({
            entries: Array.from({ length: 50 }, (_, i) => String(i + 10)), index: 49,
        });
    });
});
