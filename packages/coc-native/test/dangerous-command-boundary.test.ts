/**
 * N-API boundary tests for the dangerous-command guard.
 *
 * The rule set's own semantics — which shapes match, which lookalikes do not,
 * how a command is split into segments — are pinned by the Rust suite in
 * `rust/core/tests/dangerous_command.rs`. What is only testable here is what
 * crossing into JavaScript does to them: that a verdict arrives with its
 * camelCase field names, that a miss arrives as `matched: false` with the other
 * fields absent rather than as an empty string, and that the fail-open wrapper
 * really does swallow an unloadable addon.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    loadNativeDangerousCommandGuard,
    nativeDangerousCommandGuardStatus,
    tryMatchDangerousCommand,
} from '../src/dangerous-command';
import { resetNativeAddonCache } from '../src/loader';

const addon = loadNativeDangerousCommandGuard();

describe('marshalling', () => {
    it('reports a match with its rule, reason and segment', () => {
        const verdict = addon.matchDangerousCommand('cd /tmp && rm -rf / && echo done');

        expect(verdict.matched).toBe(true);
        expect(verdict.ruleId).toBe('rm-recursive-dangerous-target');
        expect(verdict.matchedSegment).toBe('rm -rf /');
        expect(verdict.description).toBeTruthy();
    });

    it('reports a miss with no rule fields at all', () => {
        const verdict = addon.matchDangerousCommand('npm test');

        expect(verdict.matched).toBe(false);
        expect(verdict.ruleId ?? null).toBeNull();
        expect(verdict.description ?? null).toBeNull();
        expect(verdict.matchedSegment ?? null).toBeNull();
    });

    it('carries a command with non-ASCII bytes and newlines across unchanged', () => {
        const verdict = addon.matchDangerousCommand('echo "日本語"\nrm -rf ~/プロジェクト');

        expect(verdict.matched).toBe(true);
        expect(verdict.matchedSegment).toBe('rm -rf ~/プロジェクト');
    });

    it('accepts an empty command', () => {
        expect(addon.matchDangerousCommand('').matched).toBe(false);
    });

    it('is synchronous — the verdict is the value, not a promise', () => {
        expect(addon.matchDangerousCommand('ls')).not.toBeInstanceOf(Promise);
    });
});

describe('fail-open wrapper', () => {
    const previous = process.env.COC_NATIVE_PATH;

    afterEach(() => {
        if (previous === undefined) delete process.env.COC_NATIVE_PATH;
        else process.env.COC_NATIVE_PATH = previous;
        resetNativeAddonCache();
    });

    it('screens normally while the addon is loadable', () => {
        expect(tryMatchDangerousCommand('rm -rf /')?.matched).toBe(true);
        expect(tryMatchDangerousCommand('ls -la')?.matched).toBe(false);
    });

    it('returns null instead of throwing when no binary exists', () => {
        process.env.COC_NATIVE_PATH = path.join(os.tmpdir(), 'coc-native-absent.node');
        resetNativeAddonCache();

        expect(tryMatchDangerousCommand('rm -rf /')).toBeNull();
        expect(nativeDangerousCommandGuardStatus().loaded).toBe(false);
        expect(() => loadNativeDangerousCommandGuard()).toThrow();
    });

    it('returns null instead of throwing when the binary will not load', () => {
        const broken = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-broken-')), 'x.node');
        fs.writeFileSync(broken, 'not a native module');
        process.env.COC_NATIVE_PATH = broken;
        resetNativeAddonCache();

        expect(tryMatchDangerousCommand('shutdown -h now')).toBeNull();
        expect(nativeDangerousCommandGuardStatus().loaded).toBe(false);
    });
});
