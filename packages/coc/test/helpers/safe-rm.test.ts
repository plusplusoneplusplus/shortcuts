/**
 * Tests for Windows-safe directory removal helpers.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeRmSync, safeRm } from './safe-rm';

describe('safeRmSync', () => {
    it('removes an existing directory with nested content', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-rm-test-'));
        const subDir = path.join(tmpDir, 'sub');
        fs.mkdirSync(subDir);
        fs.writeFileSync(path.join(subDir, 'file.txt'), 'hello');
        safeRmSync(tmpDir);
        expect(fs.existsSync(tmpDir)).toBe(false);
    });

    it('succeeds on non-existent path', () => {
        const nonExistent = path.join(os.tmpdir(), `safe-rm-nope-${Date.now()}`);
        expect(() => safeRmSync(nonExistent)).not.toThrow();
    });

    it('is idempotent — double-call does not throw', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-rm-idem-'));
        safeRmSync(tmpDir);
        expect(fs.existsSync(tmpDir)).toBe(false);
        // Second call on already-removed dir should not throw
        expect(() => safeRmSync(tmpDir)).not.toThrow();
    });
});

describe('safeRm', () => {
    it('removes an existing directory', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-rm-async-'));
        fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');
        await safeRm(tmpDir);
        expect(fs.existsSync(tmpDir)).toBe(false);
    });

    it('succeeds on non-existent path', async () => {
        const nonExistent = path.join(os.tmpdir(), `safe-rm-async-nope-${Date.now()}`);
        await expect(safeRm(nonExistent)).resolves.toBeUndefined();
    });

    it('is idempotent — double-call does not throw', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-rm-async-idem-'));
        await safeRm(tmpDir);
        expect(fs.existsSync(tmpDir)).toBe(false);
        await expect(safeRm(tmpDir)).resolves.toBeUndefined();
    });
});
