import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import type { ManagedChildProcess, HealthChecker } from './types';

export function startProcess(command: string, args: string[]): ManagedChildProcess {
    return spawn(command, args, {
        windowsHide: true,
        stdio: 'ignore',
    }) as ChildProcess as ManagedChildProcess;
}

export async function defaultHealthChecker(url: string, signal?: AbortSignal): Promise<boolean> {
    const res = await fetch(`${url}/api/health`, { signal });
    return res.ok;
}

export async function waitForHealth(
    url: string,
    checker: HealthChecker,
    timeoutMs: number,
    pollMs: number,
    label: string = 'Tunnel',
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() <= deadline) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(pollMs, 2_000));
        try {
            if (await checker(url, controller.signal)) {
                clearTimeout(timer);
                return;
            }
        } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
        } finally {
            clearTimeout(timer);
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    throw new Error(lastError
        ? `${label} did not become healthy within ${timeoutMs}ms: ${lastError}`
        : `${label} did not become healthy within ${timeoutMs}ms`);
}
