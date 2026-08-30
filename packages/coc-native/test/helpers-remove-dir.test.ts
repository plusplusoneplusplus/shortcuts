/**
 * `removeDir` is teardown, and teardown must not decide whether a suite is red.
 *
 * On Windows a git child's handle, or a pack file gix mapped, can outlive the
 * call that opened it, and the temp-directory delete in an `afterAll` then
 * fails with EPERM — which vitest reports as a failed suite even when all 293
 * tests in it passed. The retry usually wins that race; what is pinned here is
 * what happens when it does not.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

import { removeDir } from './helpers';

/**
 * A delete that genuinely cannot succeed, without mocking `fs` — `rmSync` is
 * non-configurable, so it cannot be spied on.
 *
 * Only POSIX, and only unprivileged: Windows ignores the mode bits, and root
 * ignores the permission. The EPERM this guards is Windows-only, but the
 * swallow it guards is not, so a Linux run still catches its removal.
 */
const canDenyWrites = process.platform !== 'win32' && process.getuid?.() !== 0;

describe('removeDir', () => {
    it('removes a directory and everything under it', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-remove-dir-'));
        fs.mkdirSync(path.join(dir, 'nested'));
        fs.writeFileSync(path.join(dir, 'nested', 'file.txt'), 'x\n');

        removeDir(dir);

        expect(fs.existsSync(dir)).toBe(false);
    });

    it('tolerates a directory that is already gone', () => {
        expect(() =>
            removeDir(path.join(os.tmpdir(), 'coc-native-remove-dir-never-existed')),
        ).not.toThrow();
    });

    it.runIf(canDenyWrites)('gives up quietly when the delete cannot succeed', () => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-remove-dir-locked-'));
        const child = path.join(parent, 'child');
        fs.mkdirSync(child);
        fs.chmodSync(parent, 0o500);
        try {
            expect(() => removeDir(child)).not.toThrow();
            // And it really was refused — otherwise this asserts nothing.
            expect(fs.existsSync(child)).toBe(true);
        } finally {
            fs.chmodSync(parent, 0o700);
            fs.rmSync(parent, { recursive: true, force: true });
        }
    });
});
