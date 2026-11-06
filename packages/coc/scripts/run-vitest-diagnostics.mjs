import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export function readOptionalDelay(value, name) {
    if (value === undefined) return 0;
    const delay = Number(value);
    if (!Number.isSafeInteger(delay) || delay <= 0 || delay > 2_147_483_647) {
        throw new Error(`${name} must be a positive timer duration in milliseconds`);
    }
    return delay;
}

export function createTestProcessTerminator(child, processGroup, killAfterMs = 5_000) {
    let forceKillTimer;
    function signal(signalName) {
        if (!processGroup) return child.kill(signalName);
        try {
            return process.kill(-child.pid, signalName);
        } catch (error) {
            if (error.code !== 'ESRCH') throw error;
            return false;
        }
    }
    return {
        terminate() {
            if (forceKillTimer) return;
            signal('SIGTERM');
            forceKillTimer = setTimeout(() => signal('SIGKILL'), killAfterMs);
        },
        dispose() {
            clearTimeout(forceKillTimer);
            if (forceKillTimer && processGroup) signal('SIGKILL');
        },
    };
}

export function selectProcessGroupPids(snapshot, groupPid) {
    return snapshot.split('\n').flatMap(line => {
        const row = /^\s*(\d+)\s+(\d+)\s+/.exec(line);
        return row && Number(row[2]) === groupPid ? [Number(row[1])] : [];
    });
}

export async function captureMacSamples(groupPid, directory, log = console.error, run = execute) {
    const { stdout } = await run('ps', ['-axo', 'pid=,pgid=,pcpu=,stat=,comm='], { timeout: 5_000 });
    const pids = selectProcessGroupPids(stdout, groupPid);
    log(`[Vitest diagnostics] Process group ${groupPid}: ${pids.join(', ') || 'already exited'}`);
    log(stdout.split('\n').filter(line => selectProcessGroupPids(line, groupPid).length).join('\n'));
    if (pids.length === 1) log('[Vitest diagnostics] No descendant worker found in the test process group');
    await mkdir(directory, { recursive: true });
    for (const pid of pids) {
        const file = path.join(directory, `process-${pid}.sample.txt`);
        try {
            await run('sample', [String(pid), '1', '10', '-mayDie', '-file', file], { timeout: 10_000 });
            log(await readFile(file, 'utf8'));
        } catch (error) {
            log(`[Vitest diagnostics] Sampling PID ${pid} failed: ${error.message}`);
        }
    }
}
