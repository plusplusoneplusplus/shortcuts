import { describe, expect, it, vi } from 'vitest';
import { createAttachmentScope } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/attachmentScope';

describe('createAttachmentScope', () => {
    it('aborts its signal before releasing, then releases in reverse order', () => {
        const scope = createAttachmentScope();
        const order: string[] = [];
        scope.add(() => order.push(`first:${scope.signal.aborted}`));
        scope.add(() => order.push(`second:${scope.signal.aborted}`));
        scope.dispose();
        expect(order).toEqual(['second:true', 'first:true']);
    });

    it('releases each resource once across repeated disposal', () => {
        const scope = createAttachmentScope();
        const release = vi.fn();
        scope.add(release);
        scope.dispose();
        scope.dispose();
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('releases a resource added after disposal immediately', () => {
        const scope = createAttachmentScope();
        scope.dispose();
        const release = vi.fn();
        scope.add(release);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('runs every release when one throws, then reports the first failure', () => {
        const scope = createAttachmentScope();
        const last = vi.fn();
        scope.add(last);
        scope.add(() => { throw new Error('second'); });
        scope.add(() => { throw new Error('first'); });
        expect(() => scope.dispose()).toThrow('first');
        expect(last).toHaveBeenCalledTimes(1);
        expect(scope.signal.aborted).toBe(true);
    });
});
