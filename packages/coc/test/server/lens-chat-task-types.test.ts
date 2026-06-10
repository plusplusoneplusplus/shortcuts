import { describe, expect, it } from 'vitest';
import { isInheritedLensChatMode } from '../../src/server/tasks/task-types';

describe('isInheritedLensChatMode', () => {
    it('accepts the shared Lens Chat inheritance marker', () => {
        expect(isInheritedLensChatMode({
            inherited: true,
            source: 'features.commitChatLens',
        })).toBe(true);
    });

    it('rejects non-Lens and notes-specific markers', () => {
        expect(isInheritedLensChatMode(undefined)).toBe(false);
        expect(isInheritedLensChatMode({ inherited: false, source: 'features.commitChatLens' })).toBe(false);
        expect(isInheritedLensChatMode({ inherited: true, source: 'notes.lensChat' })).toBe(false);
    });
});
