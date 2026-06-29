/**
 * Unit coverage for app.asar → app.asar.unpacked path rewriting.
 *
 * Regression context: in packaged desktop builds, agent-CLI paths resolved via
 * `require.resolve` point inside `app.asar`, which `spawn` (native binary) and
 * the system `node` (copilot) cannot execute. preferUnpackedPath rewrites them
 * to the unpacked copy when it exists, and is a no-op for plain CLI installs.
 */

import { describe, it, expect } from 'vitest';
import { preferUnpackedPath } from '../src/asar-path';

const MAC_ASAR = '/Applications/CoC.app/Contents/Resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';
const MAC_UNPACKED = '/Applications/CoC.app/Contents/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';

describe('preferUnpackedPath', () => {
    it('rewrites an app.asar path to app.asar.unpacked when the unpacked file exists', () => {
        expect(preferUnpackedPath(MAC_ASAR, (p) => p === MAC_UNPACKED)).toBe(MAC_UNPACKED);
    });

    it('keeps the original path when the unpacked copy does not exist', () => {
        // e.g. a file that genuinely lives inside the archive and was not unpacked.
        expect(preferUnpackedPath(MAC_ASAR, () => false)).toBe(MAC_ASAR);
    });

    it('rewrites Windows-separator asar paths', () => {
        const win = 'C:\\Program Files\\CoC\\resources\\app.asar\\node_modules\\@github\\copilot\\index.js';
        const winUnpacked = 'C:\\Program Files\\CoC\\resources\\app.asar.unpacked\\node_modules\\@github\\copilot\\index.js';
        expect(preferUnpackedPath(win, (p) => p === winUnpacked)).toBe(winUnpacked);
    });

    it('is a no-op for a plain path with no asar segment (CLI install)', () => {
        const cli = '/usr/local/lib/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude';
        // existsSync must never even be consulted when there is no asar segment.
        expect(
            preferUnpackedPath(cli, () => {
                throw new Error('existsSync should not be called');
            }),
        ).toBe(cli);
    });

    it('does not rewrite an unrelated substring like app.asared', () => {
        const p = '/x/app.asared/y/claude';
        expect(preferUnpackedPath(p, () => true)).toBe(p);
    });

    it('falls back to the original path if the existence check throws', () => {
        expect(
            preferUnpackedPath(MAC_ASAR, () => {
                throw new Error('fs blew up');
            }),
        ).toBe(MAC_ASAR);
    });

    it('rewrites every app.asar segment in the path', () => {
        // Defensive: the regex is global, so a (pathological) doubled segment maps fully.
        const p = '/a/app.asar/b/app.asar/claude';
        const expected = '/a/app.asar.unpacked/b/app.asar.unpacked/claude';
        expect(preferUnpackedPath(p, (q) => q === expected)).toBe(expected);
    });
});
