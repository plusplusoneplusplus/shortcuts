/**
 * Unit coverage for bundled agent-CLI PATH resolution.
 *
 * Pins the behavior that makes the desktop app self-contained: resolve the
 * bundled `copilot`/`codex`/`claude` binary directories and prepend them to
 * PATH for both the forked server and the preflight. All disk/module seams are
 * injected so tests never touch the real node_modules or PATH.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
    BUNDLED_AGENTS,
    platformPackageName,
    toUnpackedPath,
    resolveBundledBinDir,
    resolveBundledAgentBinDirs,
    prependToPath,
    augmentPathWithBundledAgents,
    type BundledAgent,
    type BinResolveEnv,
} from '../src/agent-bin-path';
// Reuse the real preflight detection to prove the augmented PATH suppresses the nag.
import { detectAgentClis, missingAgentClis, AGENT_CLIS } from '../src/agent-preflight';

const COPILOT = BUNDLED_AGENTS.find((a) => a.id === 'copilot') as BundledAgent;
const CODEX = BUNDLED_AGENTS.find((a) => a.id === 'codex') as BundledAgent;
const CLAUDE = BUNDLED_AGENTS.find((a) => a.id === 'claude') as BundledAgent;

describe('bundled agent descriptors', () => {
    it('lists the three providers with families matching the platform packages', () => {
        expect(BUNDLED_AGENTS.map((a) => [a.id, a.bin, a.packageFamily])).toEqual([
            ['copilot', 'copilot', '@github/copilot'],
            ['codex', 'codex', '@openai/codex'],
            ['claude', 'claude', '@anthropic-ai/claude-agent-sdk'],
        ]);
    });

    it('covers exactly the same provider ids the preflight checks', () => {
        expect(BUNDLED_AGENTS.map((a) => a.id).sort()).toEqual(AGENT_CLIS.map((c) => c.id).sort());
    });
});

describe('platformPackageName', () => {
    it('appends -<platform>-<arch> to the family', () => {
        expect(platformPackageName('@github/copilot', 'darwin', 'arm64')).toBe('@github/copilot-darwin-arm64');
        expect(platformPackageName('@openai/codex', 'win32', 'x64')).toBe('@openai/codex-win32-x64');
    });
});

describe('toUnpackedPath', () => {
    it('rewrites the app.asar segment to app.asar.unpacked (posix)', () => {
        expect(toUnpackedPath('/A/CoC.app/Contents/Resources/app.asar/node_modules/x/bin')).toBe(
            '/A/CoC.app/Contents/Resources/app.asar.unpacked/node_modules/x/bin',
        );
    });

    it('rewrites the app.asar segment with Windows separators', () => {
        expect(toUnpackedPath('C:\\r\\app.asar\\node_modules\\x')).toBe('C:\\r\\app.asar.unpacked\\node_modules\\x');
    });

    it('is a no-op when there is no asar in the path (dev mode)', () => {
        const p = '/repo/node_modules/@github/copilot-darwin-arm64';
        expect(toUnpackedPath(p)).toBe(p);
    });

    it('does not touch an unrelated substring like app.asared', () => {
        // Only a real `app.asar` *segment* (bounded by separators) is rewritten.
        expect(toUnpackedPath('/x/app.asared/y')).toBe('/x/app.asared/y');
    });
});

describe('resolveBundledBinDir', () => {
    const env = (overrides: Partial<BinResolveEnv>): BinResolveEnv => ({
        platform: 'darwin',
        arch: 'arm64',
        ...overrides,
    });

    it('resolves a root-level binary (copilot) to its package dir', () => {
        const dir = resolveBundledBinDir(
            COPILOT,
            env({
                resolvePackageDir: (name) =>
                    name === '@github/copilot-darwin-arm64' ? '/repo/node_modules/@github/copilot-darwin-arm64' : null,
                findExecutable: (d, bin) => (bin === 'copilot' ? `${d}/copilot` : null),
            }),
        );
        expect(dir).toBe('/repo/node_modules/@github/copilot-darwin-arm64');
    });

    it('resolves a nested binary (codex under vendor/<triple>/bin) to the nested dir', () => {
        const pkg = '/repo/node_modules/@openai/codex-darwin-arm64';
        const dir = resolveBundledBinDir(
            CODEX,
            env({
                resolvePackageDir: () => pkg,
                // Mimic the bounded-depth walk finding the nested executable.
                findExecutable: (d, bin) =>
                    bin === 'codex' ? `${d}/vendor/aarch64-apple-darwin/bin/codex` : null,
            }),
        );
        expect(dir).toBe(`${pkg}/vendor/aarch64-apple-darwin/bin`);
    });

    it('rewrites asar → asar.unpacked before walking and in the result', () => {
        const asarPkg = '/A/Resources/app.asar/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64';
        const unpackedPkg = '/A/Resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64';
        const walkedDirs: string[] = [];
        const dir = resolveBundledBinDir(
            CLAUDE,
            env({
                resolvePackageDir: () => asarPkg,
                findExecutable: (d, bin) => {
                    walkedDirs.push(d);
                    return bin === 'claude' ? `${d}/claude` : null;
                },
            }),
        );
        // The walk runs against the unpacked dir, and the returned dir is unpacked.
        expect(walkedDirs).toEqual([unpackedPkg]);
        expect(dir).toBe(unpackedPkg);
    });

    it('prefers the .exe candidate on Windows', () => {
        const queried: string[] = [];
        resolveBundledBinDir(
            COPILOT,
            env({
                platform: 'win32',
                arch: 'x64',
                resolvePackageDir: () => '/repo/nm/@github/copilot-win32-x64',
                findExecutable: (_d, bin) => {
                    queried.push(bin);
                    return null;
                },
            }),
        );
        expect(queried).toEqual(['copilot.exe', 'copilot']);
    });

    it('returns null when the platform package is not installed', () => {
        expect(
            resolveBundledBinDir(COPILOT, env({ resolvePackageDir: () => null, findExecutable: () => '/x' })),
        ).toBeNull();
    });

    it('returns null when the executable is not found in the package', () => {
        expect(
            resolveBundledBinDir(COPILOT, env({ resolvePackageDir: () => '/pkg', findExecutable: () => null })),
        ).toBeNull();
    });

    it('never throws when a seam throws — degrades to null', () => {
        expect(
            resolveBundledBinDir(
                COPILOT,
                env({
                    resolvePackageDir: () => {
                        throw new Error('boom');
                    },
                }),
            ),
        ).toBeNull();
    });
});

describe('resolveBundledAgentBinDirs', () => {
    it('collects resolvable dirs and skips the rest', () => {
        const dirs = resolveBundledAgentBinDirs({
            platform: 'darwin',
            arch: 'arm64',
            resolvePackageDir: (name) => (name.includes('codex') ? null : `/nm/${name}`),
            findExecutable: (d, bin) => `${d}/${bin}`,
        });
        // copilot + claude resolve; codex skipped.
        expect(dirs).toEqual(['/nm/@github/copilot-darwin-arm64', '/nm/@anthropic-ai/claude-agent-sdk-darwin-arm64']);
    });

    it('de-duplicates identical directories', () => {
        const dirs = resolveBundledAgentBinDirs({
            platform: 'darwin',
            arch: 'arm64',
            resolvePackageDir: () => '/same',
            findExecutable: () => '/same/bin', // every provider resolves to /same
        });
        expect(dirs).toEqual(['/same']);
    });
});

describe('prependToPath', () => {
    it('prepends new dirs using the POSIX separator', () => {
        expect(prependToPath(['/a', '/b'], '/usr/bin:/bin', 'darwin')).toBe('/a:/b:/usr/bin:/bin');
    });

    it('prepends using the Windows separator', () => {
        expect(prependToPath(['C:\\a'], 'C:\\Windows;C:\\Windows\\System32', 'win32')).toBe(
            'C:\\a;C:\\Windows;C:\\Windows\\System32',
        );
    });

    it('drops dirs already present and de-dups the prefix', () => {
        expect(prependToPath(['/a', '/a', '/usr/bin'], '/usr/bin:/bin', 'darwin')).toBe('/a:/usr/bin:/bin');
    });

    it('compares case-insensitively on Windows', () => {
        expect(prependToPath(['c:\\a'], 'C:\\A;C:\\Windows', 'win32')).toBe('C:\\A;C:\\Windows');
    });

    it('handles an empty base PATH', () => {
        expect(prependToPath(['/a', '/b'], '', 'darwin')).toBe('/a:/b');
    });
});

describe('augmentPathWithBundledAgents', () => {
    it('prepends resolved bundled dirs to the given base PATH', () => {
        const out = augmentPathWithBundledAgents(
            {
                platform: 'darwin',
                arch: 'arm64',
                resolvePackageDir: (name) => `/nm/${name}`,
                findExecutable: (d, bin) => `${d}/${bin}`,
            },
            '/usr/bin:/bin',
        );
        expect(out).toBe(
            [
                '/nm/@github/copilot-darwin-arm64',
                '/nm/@openai/codex-darwin-arm64',
                '/nm/@anthropic-ai/claude-agent-sdk-darwin-arm64',
                '/usr/bin',
                '/bin',
            ].join(':'),
        );
    });

    it('returns the base PATH unchanged when nothing resolves', () => {
        const out = augmentPathWithBundledAgents(
            { platform: 'darwin', arch: 'arm64', resolvePackageDir: () => null },
            '/usr/bin:/bin',
        );
        expect(out).toBe('/usr/bin:/bin');
    });
});

describe('integration: augmented PATH suppresses the preflight nag', () => {
    it('detects all three CLIs as installed once their bundled dirs are on PATH', () => {
        const binDirs = {
            '/nm/@github/copilot-darwin-arm64': 'copilot',
            '/nm/@openai/codex-darwin-arm64/vendor/t/bin': 'codex',
            '/nm/@anthropic-ai/claude-agent-sdk-darwin-arm64': 'claude',
        } as Record<string, string>;
        const pathEnv = augmentPathWithBundledAgents(
            {
                platform: 'darwin',
                arch: 'arm64',
                resolvePackageDir: (name) => `/nm/${name}`,
                findExecutable: (d, bin) =>
                    bin === 'codex' ? `${d}/vendor/t/bin/codex` : `${d}/${bin}`,
            },
            '/usr/bin',
        );
        // fileExists seam: a binary exists iff PATH dir maps to that exact bin name.
        const statuses = detectAgentClis({
            platform: 'darwin',
            pathEnv,
            fileExists: (p) => binDirs[path.dirname(p)] === path.basename(p),
        });
        expect(statuses.every((s) => s.installed)).toBe(true);
        expect(missingAgentClis(statuses)).toEqual([]);
    });
});
