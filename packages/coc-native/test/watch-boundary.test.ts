import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { nativeAddonStatus } from '../src/loader';
import { loadNativeWatch } from '../src/watch';

const { NativeWatchService } = loadNativeWatch();

describe('native watch boundary lifecycle', () => {
    it('constructs synchronously and disposes idempotently without callbacks', () => {
        const onBatch = vi.fn();
        const handle = new NativeWatchService(onBatch);
        expect(handle).not.toBeInstanceOf(Promise);
        handle.unsubscribe(1);
        handle.unwatchWorkspace('unknown-workspace');
        handle.dispose();
        handle.dispose();
        handle.unsubscribe(1);
        handle.unwatchWorkspace('unknown-workspace');
        expect(onBatch).not.toHaveBeenCalled();
        expect(() => handle.subscribe({
            workspaceId: 'workspace-a', root: '.', recursive: true,
            ignoreDirs: [], extensions: [], respectGitignore: false, debounceMs: 0,
        })).toThrow(expect.objectContaining({
            code: 'Closing', message: 'Native watch service disposed',
        }));
    });

    it.each([false, true])('does not keep a Node process alive (disposed=%s)', disposed => {
        const script = `
            const { NativeWatchService } = require(${JSON.stringify(nativeAddonStatus().binaryPath)});
            const handle = new NativeWatchService(() => { throw new Error('unexpected batch'); });
            ${disposed ? 'handle.dispose();' : ''}
        `;
        expect(execFileSync(process.execPath, ['-e', script], {
            timeout: 10_000, encoding: 'utf8',
        })).toBe('');
    });
});
