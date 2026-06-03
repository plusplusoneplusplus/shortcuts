/**
 * Tests for git test helpers — focused on safeRmSync, the Windows-safe
 * recursive temp-dir removal used by teardown hooks.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { safeRmSync } from '../helpers/git-test-helpers';

suite('safeRmSync', function() {
    test('removes an existing directory tree', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-rm-test-'));
        fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
        fs.writeFileSync(path.join(dir, 'nested', 'b.txt'), 'b');

        safeRmSync(dir);

        assert.strictEqual(fs.existsSync(dir), false);
    });

    test('returns silently when the path does not exist (ENOENT)', () => {
        const missing = path.join(os.tmpdir(), `safe-rm-missing-${Date.now()}`);
        assert.strictEqual(fs.existsSync(missing), false);

        // Must not throw.
        assert.doesNotThrow(() => safeRmSync(missing));
    });

    test('is idempotent — a second removal of the same path is a no-op', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-rm-idem-'));
        fs.writeFileSync(path.join(dir, 'file.txt'), 'content');

        safeRmSync(dir);
        assert.strictEqual(fs.existsSync(dir), false);

        // Removing again should not throw even though the path is now gone.
        assert.doesNotThrow(() => safeRmSync(dir));
    });
});
