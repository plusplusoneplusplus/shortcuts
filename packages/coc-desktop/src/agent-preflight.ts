/**
 * CoC Desktop — agent-CLI preflight (AC-06).
 *
 * The CoC server shells out to external agent CLIs (`copilot`, `codex`,
 * `claude`) when a user resumes or starts an agent session — see
 * `packages/coc/src/server/processes/process-resume-handler.ts`, which invokes
 * `copilot --yolo`, `codex …`, and `claude --dangerously-skip-permissions`.
 * This module detects whether each one is reachable on `PATH` so the app can
 * surface non-blocking install guidance on first run.
 *
 * The app bundles those CLIs (see `agent-bin-path.ts`) and `main.ts` runs this
 * check against a PATH with the bundled directories prepended — the same PATH
 * the forked server gets — so a bundled provider reads as present and the nag
 * only appears for one that genuinely can't be resolved.
 *
 * It imports NOTHING from `electron`, so the detection + formatting logic is
 * unit-testable under plain Node/vitest. The electron wiring (showing the
 * guidance dialog) lives in `main.ts`. Filesystem and environment seams are
 * injectable so tests never touch the real PATH or `~/.coc`.
 */

import * as fs from 'fs';
import * as path from 'path';

/** One agent CLI the desktop app expects to find on the user's PATH. */
export interface AgentCli {
    /** Stable provider id — matches the coc server's provider ids. */
    id: 'copilot' | 'codex' | 'claude';
    /** Human-readable name shown in guidance. */
    label: string;
    /** Executable name probed on PATH (no extension). */
    bin: string;
    /** Best-effort install command shown in guidance. */
    installHint: string;
    /** Where to read more about installing the CLI. */
    docsUrl: string;
}

/**
 * The three agent CLIs the server can drive. Binary names mirror exactly what
 * the server spawns, so a positive preflight means the runtime will find the
 * same executable.
 */
export const AGENT_CLIS: readonly AgentCli[] = [
    {
        id: 'copilot',
        label: 'GitHub Copilot CLI',
        bin: 'copilot',
        installHint: 'npm install -g @github/copilot',
        docsUrl: 'https://github.com/github/copilot-cli',
    },
    {
        id: 'codex',
        label: 'OpenAI Codex CLI',
        bin: 'codex',
        installHint: 'npm install -g @openai/codex',
        docsUrl: 'https://github.com/openai/codex',
    },
    {
        id: 'claude',
        label: 'Claude Code CLI',
        bin: 'claude',
        installHint: 'npm install -g @anthropic-ai/claude-code',
        docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
    },
];

/** Injectable environment seams so tests never read the real PATH / fs. */
export interface PreflightEnv {
    /** Defaults to `process.platform`. */
    platform?: NodeJS.Platform;
    /** Defaults to `process.env.PATH`. */
    pathEnv?: string;
    /** Defaults to `process.env.PATHEXT` (Windows only). */
    pathExt?: string;
    /** Defaults to a safe `fs.existsSync`. */
    fileExists?: (filePath: string) => boolean;
}

function defaultFileExists(filePath: string): boolean {
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}

/**
 * Resolve true iff `bin` is reachable as an executable on PATH. Walks each PATH
 * directory directly (no subprocess) so the check is fast and fully testable.
 * On Windows it also tries each `PATHEXT` extension (`claude.cmd`, `codex.exe`…).
 */
export function isOnPath(bin: string, env: PreflightEnv = {}): boolean {
    const platform = env.platform ?? process.platform;
    const isWindows = platform === 'win32';
    const pathEnv = env.pathEnv ?? process.env.PATH ?? '';
    const fileExists = env.fileExists ?? defaultFileExists;

    const dirs = pathEnv.split(isWindows ? ';' : ':').filter(Boolean);
    // On POSIX the bin name is exact; on Windows try the bare name plus each
    // executable extension (npm global shims land as e.g. `claude.cmd`).
    const exts = isWindows
        ? ['', ...(env.pathExt ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
        : [''];
    // Join with the *target* platform's separator (not the host's) so detection
    // is correct on Windows and the function stays testable on any OS.
    const join = isWindows ? path.win32.join : path.posix.join;

    for (const dir of dirs) {
        for (const ext of exts) {
            if (fileExists(join(dir, bin + ext))) {
                return true;
            }
        }
    }
    return false;
}

/** The installed/missing verdict for a single agent CLI. */
export interface AgentCliStatus {
    cli: AgentCli;
    installed: boolean;
}

/** Probe every agent CLI and report whether each is on PATH. */
export function detectAgentClis(
    env?: PreflightEnv,
    clis: readonly AgentCli[] = AGENT_CLIS,
): AgentCliStatus[] {
    return clis.map((cli) => ({ cli, installed: isOnPath(cli.bin, env) }));
}

/** Filter detection results down to the CLIs that are not installed. */
export function missingAgentClis(statuses: readonly AgentCliStatus[]): AgentCliStatus[] {
    return statuses.filter((s) => !s.installed);
}

/** A renderable, electron-agnostic description of the guidance to surface. */
export interface PreflightGuidance {
    title: string;
    /** One-line summary suitable for a dialog `message`. */
    summary: string;
    /** Multi-line install instructions suitable for a dialog `detail`. */
    detail: string;
}

/**
 * Build non-blocking install guidance for the missing CLIs. Returns `null` when
 * nothing is missing, so callers can skip surfacing anything.
 */
export function formatPreflightGuidance(missing: readonly AgentCliStatus[]): PreflightGuidance | null {
    if (missing.length === 0) {
        return null;
    }
    const names = missing.map((m) => m.cli.label).join(', ');
    const lines = missing.map(
        (m) => `• ${m.cli.label} — install with: ${m.cli.installHint}\n  Docs: ${m.cli.docsUrl}`,
    );
    return {
        title: 'Agent CLIs not found',
        summary:
            missing.length === 1
                ? `${names} was not found on your PATH.`
                : `${missing.length} agent CLIs were not found on your PATH: ${names}.`,
        detail:
            'CoC drives these CLIs to run agent sessions. The app works without them, ' +
            'but the corresponding providers will be unavailable until you install them:\n\n' +
            lines.join('\n\n'),
    };
}

// ---------------------------------------------------------------------------
// First-run gate
//
// The preflight is a one-time nicety: once we have shown guidance we record a
// marker in the shared data dir so we do not nag on every launch. The marker is
// namespaced to the desktop app (`desktop-preflight.json`) so it never collides
// with the CLI's own files in `~/.coc`.
// ---------------------------------------------------------------------------

/** Injectable filesystem seams for the first-run marker. */
export interface PreflightStore {
    readText?: (filePath: string) => string;
    writeText?: (filePath: string, data: string) => void;
    ensureDir?: (dir: string) => void;
}

const MARKER_FILENAME = 'desktop-preflight.json';

function markerPath(dataDir: string): string {
    return path.join(dataDir, MARKER_FILENAME);
}

/**
 * True once we have already shown agent-CLI guidance for this data dir. A
 * missing or unreadable marker is treated as "not yet shown" so guidance still
 * surfaces — the gate only ever suppresses, never blocks.
 */
export function hasShownPreflightGuidance(dataDir: string, store: PreflightStore = {}): boolean {
    const readText = store.readText ?? ((p) => fs.readFileSync(p, 'utf8'));
    try {
        const parsed = JSON.parse(readText(markerPath(dataDir))) as { guidanceShown?: boolean };
        return parsed?.guidanceShown === true;
    } catch {
        return false;
    }
}

/** Record that guidance has been shown so it is not repeated next launch. */
export function markPreflightGuidanceShown(dataDir: string, store: PreflightStore = {}): void {
    const ensureDir = store.ensureDir ?? ((d) => { fs.mkdirSync(d, { recursive: true }); });
    const writeText = store.writeText ?? ((p, data) => fs.writeFileSync(p, data));
    try {
        ensureDir(dataDir);
        writeText(markerPath(dataDir), JSON.stringify({ guidanceShown: true }));
    } catch {
        // Best-effort: failing to persist the marker only means we may re-show
        // guidance next launch, which is harmless.
    }
}

/**
 * Convenience: run the full first-run preflight against a data dir and return
 * the guidance to surface, or `null` if there is nothing to show (everything
 * installed, or guidance already shown for this data dir).
 */
export function runFirstRunPreflight(
    dataDir: string,
    env?: PreflightEnv,
    store?: PreflightStore,
): PreflightGuidance | null {
    if (hasShownPreflightGuidance(dataDir, store)) {
        return null;
    }
    const guidance = formatPreflightGuidance(missingAgentClis(detectAgentClis(env)));
    if (guidance) {
        markPreflightGuidanceShown(dataDir, store);
    }
    return guidance;
}
