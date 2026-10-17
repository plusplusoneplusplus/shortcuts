/**
 * Startup smoke test: the REAL desktop app (`dist/main.js` via `electron .`)
 * boots its REAL forked server (`dist/server-entry.js`) whose readiness is held
 * back past 30s by the opt-in SERVER_START_DELAY_ENV seam, and must still wait
 * for it (inside the controller's 120s allowance) and load the served SPA.
 *
 * Guarantees, in order:
 *  - isolation: HOME/USERPROFILE (so `~/.coc` and config), the desktop log dir
 *    and Electron `--user-data-dir` all live in a fresh sandbox; COC_* env is
 *    stripped; the preflight dialog is pre-dismissed. DevTunnel stays off (no
 *    config) and the update check never runs (unpackaged).
 *  - no false pass from attaching: refuse to start when a CoC server already
 *    answers on the attach port, fail on an "attached (external)" log line, and
 *    require /api/health to report the identity seeded into the sandbox.
 *  - bounded deadlines at every checkpoint; Electron exiting or logging a
 *    startup failure fails immediately with diagnostics.
 *  - cleanup kills the exact Electron process tree and verifies the forked
 *    server PID (announced by the seam) is gone.
 *
 * Source-built app only (not the packaged installer). Opt-in: runs only with
 * COC_DESKTOP_STARTUP_SMOKE=1 after `npm run build -w packages/coc` and this
 * package's build (Windows CI does). Set COC_DESKTOP_STARTUP_SMOKE_DIR to keep
 * a failed run's sandbox (logs, timeline, Electron output) somewhere uploadable.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_DEFAULT_PORT, DEFAULT_HOST, DEFAULT_START_TIMEOUT_MS, findFreePort, probeHealth } from '../../src/server-controller';
import { SERVER_START_DELAY_ENV } from '../../src/startup-delay';
import { DESKTOP_LOG_FILENAME } from '../../src/desktop-logging';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..', '..');

/** Past the 30s mark the regression was about, with headroom for a real boot inside 120s. */
const DELAY_MS = 45_000;
const MARKER_DEADLINE_MS = 60_000;
const SPA_DEADLINE_MS = 60_000;
const EXIT_DEADLINE_MS = 15_000;
const POLL_MS = 250;

const skip = process.env.COC_DESKTOP_STARTUP_SMOKE !== '1';

interface Run {
    sandbox: string;
    child: ChildProcess;
    startedAt: number;
    output: string;
    timeline: Array<{ t: number; event: string }>;
    serverPid?: number;
    cdpPort: number;
    logFile: string;
    passed: boolean;
}

let run: Run | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readLog(r: Run): string {
    try {
        return readFileSync(r.logFile, 'utf8');
    } catch {
        return '';
    }
}

function exited(child: ChildProcess): boolean {
    return child.exitCode !== null || child.signalCode !== null;
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
}

function note(r: Run, event: string): number {
    const t = Date.now() - r.startedAt;
    r.timeline.push({ t, event });
    return t;
}

async function cdpTargets(r: Run): Promise<Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>> {
    const res = await fetch(`http://${DEFAULT_HOST}:${r.cdpPort}/json/list`, { signal: AbortSignal.timeout(5_000) });
    return (await res.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
}

/** `Runtime.evaluate` one expression in a page over its CDP socket. */
function cdpEvaluate(wsUrl: string, expression: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timer = setTimeout(() => { ws.close(); reject(new Error('CDP evaluate timed out')); }, 10_000);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
        ws.onmessage = (event) => {
            const msg = JSON.parse(String(event.data)) as { id?: number; error?: unknown; result?: { result?: { value?: unknown }; exceptionDetails?: unknown } };
            if (msg.id !== 1) return;
            clearTimeout(timer);
            ws.close();
            if (msg.error || msg.result?.exceptionDetails) {
                reject(new Error(`CDP evaluate failed: ${JSON.stringify(msg.error ?? msg.result?.exceptionDetails)}`));
            } else {
                resolve(msg.result?.result?.value);
            }
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('CDP socket error')); };
    });
}

function diagnostics(r: Run, extra = ''): string {
    const tail = (text: string) => text.split(/\r?\n/).slice(-120).join('\n');
    return [
        extra,
        `sandbox (kept on failure): ${r.sandbox}`,
        `electron pid=${r.child.pid} exitCode=${r.child.exitCode} signal=${r.child.signalCode}`,
        `timeline: ${JSON.stringify(r.timeline)}`,
        `--- ${DESKTOP_LOG_FILENAME} (tail) ---\n${tail(readLog(r))}`,
        `--- electron stdout/stderr (tail) ---\n${tail(r.output)}`,
    ].join('\n');
}

/**
 * Poll until `probe` yields a value, failing fast (with diagnostics) when the
 * deadline passes, Electron exits, or the app reports a startup failure/attach.
 */
async function waitFor<T>(r: Run, label: string, deadlineMs: number, probe: () => T | undefined | Promise<T | undefined>): Promise<T> {
    const deadline = Date.now() + deadlineMs;
    for (;;) {
        const log = readLog(r);
        const failure = /failed to start CoC server: (.*)/.exec(log);
        if (failure) throw new Error(diagnostics(r, `Desktop reported a startup failure while waiting for ${label}: ${failure[1]}`));
        if (/server attached \(external\)/.test(log)) throw new Error(diagnostics(r, 'Desktop attached to an external server instead of starting its own'));
        if (exited(r.child)) throw new Error(diagnostics(r, `Electron exited while waiting for ${label}`));
        const value = await probe();
        if (value !== undefined) return value;
        if (Date.now() > deadline) throw new Error(diagnostics(r, `Timed out after ${deadlineMs}ms waiting for ${label}`));
        await sleep(POLL_MS);
    }
}

/** Kill the exact Electron tree; confirm the forked server went with it. Returns leak messages. */
async function cleanup(r: Run): Promise<string[]> {
    const leaks: string[] = [];
    const pid = r.child.pid;
    if (pid && !exited(r.child)) {
        if (process.platform === 'win32') {
            const res = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 30_000, encoding: 'utf8' });
            note(r, `taskkill exit=${res.status} ${String(res.stdout ?? '').trim()} ${String(res.stderr ?? '').trim()}`);
        } else {
            try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
        }
        const deadline = Date.now() + EXIT_DEADLINE_MS;
        while (!exited(r.child) && Date.now() < deadline) await sleep(POLL_MS);
        if (!exited(r.child)) leaks.push(`Electron pid ${pid} survived the tree kill`);
    }
    if (r.serverPid) {
        const deadline = Date.now() + EXIT_DEADLINE_MS;
        while (isAlive(r.serverPid) && Date.now() < deadline) await sleep(POLL_MS);
        if (isAlive(r.serverPid)) {
            leaks.push(`forked server pid ${r.serverPid} outlived Electron`);
            if (process.platform === 'win32') {
                spawnSync('taskkill', ['/PID', String(r.serverPid), '/T', '/F'], { windowsHide: true, timeout: 30_000 });
            } else {
                try { process.kill(r.serverPid, 'SIGKILL'); } catch { /* already gone */ }
            }
        }
    }
    return leaks;
}

describe.skipIf(skip)('desktop startup smoke (real Electron app + forked server, delayed readiness)', () => {
    afterAll(async () => {
        if (!run) return;
        const r = run;
        const leaks = await cleanup(r);
        try {
            writeFileSync(path.join(r.sandbox, 'electron-output.log'), r.output);
            writeFileSync(path.join(r.sandbox, 'timeline.json'), JSON.stringify(r.timeline, null, 2));
        } catch { /* diagnostics only */ }
        if (r.passed && leaks.length === 0) {
            rmSync(r.sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
        } else {
            console.error(`[startup-smoke] sandbox kept for diagnostics: ${r.sandbox}`);
        }
        expect(leaks, diagnostics(r, 'process cleanup')).toEqual([]);
    }, 90_000);

    it(`waits ${DELAY_MS / 1000}s for its own forked server, then loads the served SPA`, async () => {
        for (const built of ['dist/main.js', 'dist/server-entry.js', '../coc/dist/server/index.js']) {
            expect(existsSync(path.join(pkgRoot, built)), `missing ${built} — build coc and coc-desktop first`).toBe(true);
        }
        // A healthy server on the attach port would be attached, not started.
        expect(await probeHealth(DEFAULT_HOST, CLI_DEFAULT_PORT), `a CoC server already answers on ${DEFAULT_HOST}:${CLI_DEFAULT_PORT}; Desktop would attach to it`).toBe(false);

        const root = process.env.COC_DESKTOP_STARTUP_SMOKE_DIR || os.tmpdir();
        mkdirSync(root, { recursive: true });
        const sandbox = mkdtempSync(path.join(root, 'coc-desktop-startup-'));
        const home = path.join(sandbox, 'home');
        const dataDir = path.join(home, '.coc');
        const logDir = path.join(sandbox, 'logs');
        const userData = path.join(sandbox, 'user-data');
        for (const dir of [dataDir, logDir, userData]) mkdirSync(dir, { recursive: true });
        const identity = randomUUID();
        writeFileSync(path.join(dataDir, 'server-identity.json'), JSON.stringify({ serverIdentity: identity }) + '\n');
        writeFileSync(path.join(dataDir, 'desktop-preflight.json'), JSON.stringify({ guidanceShown: true }));

        const env: NodeJS.ProcessEnv = { ...process.env };
        for (const key of Object.keys(env)) {
            if (key.startsWith('COC_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
        }
        Object.assign(env, { HOME: home, USERPROFILE: home, COC_DESKTOP_LOG_DIR: logDir, [SERVER_START_DELAY_ENV]: String(DELAY_MS) });

        const cdpPort = await findFreePort(DEFAULT_HOST, 0);
        const electron = createRequire(import.meta.url)('electron') as unknown as string;
        const args = [
            ...(process.env.COC_DESKTOP_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
            `--user-data-dir=${userData}`,
            `--remote-debugging-port=${cdpPort}`,
            '--remote-allow-origins=*',
            pkgRoot,
        ];
        const child = spawn(electron, args, { env, cwd: sandbox, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
        const r: Run = run = {
            sandbox, child, startedAt: Date.now(), output: '', timeline: [], cdpPort,
            logFile: path.join(logDir, DESKTOP_LOG_FILENAME), passed: false,
        };
        child.stdout?.on('data', (d) => { r.output += String(d); });
        child.stderr?.on('data', (d) => { r.output += String(d); });
        child.on('error', (err) => { r.output += `\n[spawn error] ${err.message}\n`; });
        child.on('exit', (code, signal) => note(r, `electron exit code=${code} signal=${signal}`));
        note(r, `spawned electron pid=${child.pid}`);

        // 1) The forked server-entry announces the seam — proof our child is the one booting.
        const marker = await waitFor(r, 'the server-entry delay marker', MARKER_DEADLINE_MS, () => {
            const m = /server-entry pid=(\d+) delaying startup (\d+)ms/.exec(readLog(r));
            return m ? { pid: Number(m[1]), ms: Number(m[2]) } : undefined;
        });
        r.serverPid = marker.pid;
        const tMarker = note(r, `delay marker server pid=${marker.pid}`);
        expect(marker.ms).toBe(DELAY_MS);

        // 2) Past 30s into the hold-back, Desktop must still be waiting — alive, no
        // failure, no server announced, and only the splash page is showing.
        const checkAt = r.startedAt + tMarker + 33_000;
        await waitFor(r, 'the 33s mid-delay checkpoint', 40_000, () => (Date.now() >= checkAt ? true : undefined));
        expect(readLog(r)).not.toMatch(/server started \(forked\)/);
        const midTargets = await cdpTargets(r);
        expect(midTargets.some((t) => t.type === 'page' && t.url.startsWith('http')), diagnostics(r, JSON.stringify(midTargets))).toBe(false);
        note(r, 'still waiting past 30s');

        // 3) Readiness arrives after the full delay, within the 120s allowance.
        const serverUrl = await waitFor(r, 'server started (forked)', DEFAULT_START_TIMEOUT_MS + 10_000, () =>
            /\[coc-desktop\] server started \(forked\) at (http:\/\/\S+)/.exec(readLog(r))?.[1]);
        const tReady = note(r, `server started at ${serverUrl}`);
        expect(tReady - tMarker, diagnostics(r)).toBeGreaterThanOrEqual(DELAY_MS - 2_000);

        // 4) It is OUR isolated server, with the native capabilities loaded.
        const health = await (await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(10_000) })).json() as {
            status?: string; serverIdentity?: string; nativeFileIndex?: { loaded?: boolean }; nativeNotesIndex?: { loaded?: boolean };
        };
        expect(health, diagnostics(r)).toMatchObject({ status: 'ok', serverIdentity: identity, nativeFileIndex: { loaded: true }, nativeNotesIndex: { loaded: true } });

        // 5) The main window rendered the served SPA.
        const page = await waitFor(r, 'the SPA to render in the main window', SPA_DEADLINE_MS, async () => {
            const target = (await cdpTargets(r)).find((t) => t.type === 'page' && t.url.startsWith(serverUrl) && t.webSocketDebuggerUrl);
            if (!target) return undefined;
            const state = JSON.parse(String(await cdpEvaluate(target.webSocketDebuggerUrl!, `JSON.stringify({
                href: location.href,
                readyState: document.readyState,
                rootChildren: document.getElementById('app-root')?.childElementCount ?? -1,
                // The bundle is inlined, so prove the page is the CoC dashboard via its injected config.
                dashboard: typeof window.__DASHBOARD_CONFIG__?.apiBasePath === 'string',
            })`))) as { href: string; readyState: string; rootChildren: number; dashboard: boolean };
            return state.readyState === 'complete' && state.rootChildren > 0 ? state : undefined;
        });
        note(r, `SPA rendered ${JSON.stringify(page)}`);
        expect(page.dashboard).toBe(true);

        // Electron honoured the isolated profile rather than the real one.
        expect(readdirSync(userData).length, diagnostics(r, 'user-data-dir unused')).toBeGreaterThan(0);
        r.passed = true;
    }, MARKER_DEADLINE_MS + 40_000 + DEFAULT_START_TIMEOUT_MS + SPA_DEADLINE_MS + 30_000);
});
