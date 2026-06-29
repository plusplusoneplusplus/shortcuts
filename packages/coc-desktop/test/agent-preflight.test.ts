/**
 * Unit tests for the AC-06 agent-CLI preflight.
 *
 * The detection, formatting, and first-run gate are all electron-free and take
 * injectable env / fs seams, so we can assert PATH probing, missing-CLI
 * guidance, and the once-only marker without touching the real PATH or `~/.coc`.
 */

import { describe, it, expect } from 'vitest';
import {
    AGENT_CLIS,
    isOnPath,
    detectAgentClis,
    missingAgentClis,
    formatPreflightGuidance,
    hasShownPreflightGuidance,
    markPreflightGuidanceShown,
    runFirstRunPreflight,
    type PreflightEnv,
    type PreflightStore,
} from '../src/agent-preflight';

/**
 * Build a fileExists seam that reports the given paths as present. Matching is
 * case-insensitive to model real Windows (and default macOS) filesystems, so a
 * `claude.cmd` shim is found by a `.CMD` PATHEXT probe.
 */
function existsOnly(present: string[]): (p: string) => boolean {
    const set = new Set(present.map((p) => p.toLowerCase()));
    return (p) => set.has(p.toLowerCase());
}

describe('AGENT_CLIS', () => {
    it('covers the three providers the server spawns, by their real binary names', () => {
        const byId = Object.fromEntries(AGENT_CLIS.map((c) => [c.id, c.bin]));
        expect(byId).toEqual({ copilot: 'copilot', codex: 'codex', claude: 'claude' });
    });
});

describe('isOnPath (POSIX)', () => {
    const env: PreflightEnv = {
        platform: 'linux',
        pathEnv: '/usr/local/bin:/usr/bin',
    };

    it('finds a binary present in a PATH directory', () => {
        expect(isOnPath('claude', { ...env, fileExists: existsOnly(['/usr/local/bin/claude']) })).toBe(true);
    });

    it('returns false when the binary is in no PATH directory', () => {
        expect(isOnPath('codex', { ...env, fileExists: existsOnly(['/usr/local/bin/claude']) })).toBe(false);
    });

    it('does not append Windows extensions on POSIX', () => {
        // `claude.cmd` exists but the bare `claude` does not → not found on POSIX.
        expect(isOnPath('claude', { ...env, fileExists: existsOnly(['/usr/bin/claude.cmd']) })).toBe(false);
    });

    it('returns false for an empty PATH', () => {
        expect(isOnPath('claude', { platform: 'linux', pathEnv: '', fileExists: () => true })).toBe(false);
    });
});

describe('isOnPath (Windows)', () => {
    const env: PreflightEnv = {
        platform: 'win32',
        pathEnv: 'C:\\bin;C:\\tools',
        pathExt: '.COM;.EXE;.CMD',
    };

    it('matches a .cmd shim via PATHEXT', () => {
        expect(isOnPath('claude', { ...env, fileExists: existsOnly(['C:\\bin\\claude.cmd']) })).toBe(true);
    });

    it('matches a bare executable with no extension', () => {
        expect(isOnPath('codex', { ...env, fileExists: existsOnly(['C:\\tools\\codex']) })).toBe(true);
    });

    it('returns false when no extension variant is present', () => {
        expect(isOnPath('copilot', { ...env, fileExists: existsOnly(['C:\\bin\\claude.cmd']) })).toBe(false);
    });
});

describe('detectAgentClis / missingAgentClis', () => {
    const env: PreflightEnv = { platform: 'linux', pathEnv: '/usr/local/bin' };

    it('reports installed vs missing per CLI', () => {
        const statuses = detectAgentClis({ ...env, fileExists: existsOnly(['/usr/local/bin/claude']) });
        expect(statuses).toHaveLength(3);
        const claude = statuses.find((s) => s.cli.id === 'claude');
        const codex = statuses.find((s) => s.cli.id === 'codex');
        expect(claude?.installed).toBe(true);
        expect(codex?.installed).toBe(false);
    });

    it('missingAgentClis keeps only the uninstalled ones', () => {
        const statuses = detectAgentClis({ ...env, fileExists: existsOnly(['/usr/local/bin/copilot']) });
        const missing = missingAgentClis(statuses).map((m) => m.cli.id);
        expect(missing).toEqual(['codex', 'claude']);
    });
});

describe('formatPreflightGuidance', () => {
    it('returns null when nothing is missing', () => {
        expect(formatPreflightGuidance([])).toBeNull();
    });

    it('lists each missing CLI with its install hint and docs url', () => {
        const statuses = detectAgentClis({ platform: 'linux', pathEnv: '/x', fileExists: () => false });
        const guidance = formatPreflightGuidance(missingAgentClis(statuses));
        expect(guidance).not.toBeNull();
        expect(guidance!.title).toMatch(/Agent CLIs not found/i);
        for (const cli of AGENT_CLIS) {
            expect(guidance!.detail).toContain(cli.label);
            expect(guidance!.detail).toContain(cli.installHint);
            expect(guidance!.detail).toContain(cli.docsUrl);
        }
    });

    it('uses a singular summary when exactly one CLI is missing', () => {
        const statuses = detectAgentClis({
            platform: 'linux',
            pathEnv: '/usr/local/bin',
            fileExists: existsOnly(['/usr/local/bin/copilot', '/usr/local/bin/codex']),
        });
        const guidance = formatPreflightGuidance(missingAgentClis(statuses));
        expect(guidance!.summary).toContain('Claude Code CLI');
        expect(guidance!.summary).not.toMatch(/\d+ agent CLIs/);
    });
});

describe('first-run marker', () => {
    /** An in-memory PreflightStore backed by a Map. */
    function memStore(): { store: PreflightStore; files: Map<string, string> } {
        const files = new Map<string, string>();
        const store: PreflightStore = {
            readText: (p) => {
                if (!files.has(p)) {
                    throw new Error(`ENOENT: ${p}`);
                }
                return files.get(p)!;
            },
            writeText: (p, data) => { files.set(p, data); },
            ensureDir: () => { /* no-op in memory */ },
        };
        return { store, files };
    }

    it('reports not-shown when the marker is absent', () => {
        const { store } = memStore();
        expect(hasShownPreflightGuidance('/data', store)).toBe(false);
    });

    it('round-trips the shown marker', () => {
        const { store } = memStore();
        markPreflightGuidanceShown('/data', store);
        expect(hasShownPreflightGuidance('/data', store)).toBe(true);
    });

    it('treats unparseable marker content as not-shown', () => {
        const { store, files } = memStore();
        files.set('/data/desktop-preflight.json', 'not json');
        expect(hasShownPreflightGuidance('/data', store)).toBe(false);
    });
});

describe('runFirstRunPreflight', () => {
    const allMissing: PreflightEnv = { platform: 'linux', pathEnv: '/x', fileExists: () => false };

    function memStore(): PreflightStore {
        const files = new Map<string, string>();
        return {
            readText: (p) => {
                if (!files.has(p)) { throw new Error('ENOENT'); }
                return files.get(p)!;
            },
            writeText: (p, data) => { files.set(p, data); },
            ensureDir: () => { /* no-op */ },
        };
    }

    it('returns guidance on first run and marks it shown', () => {
        const store = memStore();
        const first = runFirstRunPreflight('/data', allMissing, store);
        expect(first).not.toBeNull();
        expect(hasShownPreflightGuidance('/data', store)).toBe(true);
    });

    it('suppresses guidance on a subsequent run', () => {
        const store = memStore();
        runFirstRunPreflight('/data', allMissing, store);
        const second = runFirstRunPreflight('/data', allMissing, store);
        expect(second).toBeNull();
    });

    it('returns null (and does not mark) when every CLI is installed', () => {
        const store = memStore();
        const allPresent: PreflightEnv = { platform: 'linux', pathEnv: '/usr/bin', fileExists: () => true };
        const result = runFirstRunPreflight('/data', allPresent, store);
        expect(result).toBeNull();
        // Nothing was missing, so we did not burn the one-time marker.
        expect(hasShownPreflightGuidance('/data', store)).toBe(false);
    });
});
