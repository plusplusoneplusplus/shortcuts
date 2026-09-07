/**
 * Regression coverage for the de-vendored shared utilities.
 *
 * `forge/utils/path-utils` and `forge/git/origin-id` are imported by React
 * components, but their implementations now live behind package boundaries —
 * path helpers in the agent SDK, origin identity in a pure forge subpath. A
 * re-export that reaches the Node-only `coc-agent-sdk/platform` barrel, or an
 * origin resolver that reaches back into `crypto`, would only break at bundle
 * time; the server TypeScript build compiles neither of these entry points.
 *
 * So bundle the *built* package entry points for `platform: 'browser'` and
 * assert the transitive input set stays free of Node builtins, provider SDK
 * implementations and native-addon loading.
 */

import { describe, it, expect } from 'vitest';
import * as esbuild from 'esbuild';

const BROWSER_SAFE_ENTRY_POINTS = [
    '@plusplusoneplusplus/forge/utils/path-utils',
    '@plusplusoneplusplus/forge/git/origin-id',
    '@plusplusoneplusplus/forge/git/normalize-url',
    '@plusplusoneplusplus/coc-agent-sdk/platform/path-utils',
];

const NODE_BUILTINS = [
    'path', 'fs', 'os', 'child_process', 'crypto', 'http', 'https', 'net', 'tls', 'util', 'stream',
];

function bundleForBrowser(entryPoint: string): esbuild.BuildResult<{ metafile: true }> {
    return esbuild.buildSync({
        stdin: {
            contents: `export * from ${JSON.stringify(entryPoint)};`,
            resolveDir: process.cwd(),
            loader: 'js',
        },
        bundle: true,
        write: false,
        platform: 'browser',
        format: 'esm',
        metafile: true,
    });
}

describe.each(BROWSER_SAFE_ENTRY_POINTS)('%s browser boundary', entryPoint => {
    it('bundles for the browser without unresolved Node builtins', () => {
        expect(() => bundleForBrowser(entryPoint)).not.toThrow();
    });

    it('pulls in no Node builtins, provider SDKs or native addons', () => {
        const inputs = Object.keys(bundleForBrowser(entryPoint).metafile.inputs);

        for (const input of inputs) {
            for (const builtin of NODE_BUILTINS) {
                expect(input).not.toBe(builtin);
                expect(input).not.toBe(`node:${builtin}`);
            }
            expect(input).not.toMatch(/coc-native/);
            expect(input).not.toMatch(/\.node$/);
            expect(input).not.toMatch(/coc-agent-sdk[/\\]dist[/\\][^/\\]*sdk-service/);
            expect(input).not.toMatch(/coc-agent-sdk[/\\]dist[/\\]platform[/\\]workspace-execution/);
            expect(input).not.toMatch(/coc-agent-sdk[/\\]dist[/\\]platform[/\\]exec-utils/);
            expect(input).not.toMatch(/coc-agent-sdk[/\\]dist[/\\]platform[/\\]path-security/);
            expect(input).not.toMatch(/coc-agent-sdk[/\\]dist[/\\]platform[/\\]index/);
            expect(input).not.toMatch(/forge[/\\]dist[/\\]index\.js$/);
        }

        expect(inputs.length).toBeGreaterThan(0);
    });
});

describe('coc-agent-sdk/platform', () => {
    it('is Node-only, which is why the browser-safe re-exports must bypass it', () => {
        // Sanity check in the other direction: if this ever bundles cleanly for
        // the browser, the assertions above have stopped proving anything.
        expect(() => bundleForBrowser('@plusplusoneplusplus/coc-agent-sdk/platform'))
            .toThrow(/child_process|"path"/);
    });
});
