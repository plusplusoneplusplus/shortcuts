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
    requestTimeoutMs: number = 5_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() <= deadline) {
        const controller = new AbortController();
        // Per-attempt timeout is independent of the poll interval: a single health request over a
        // WAN tunnel relay can easily take longer than pollMs, so clamping to pollMs would abort
        // every attempt on remote tunnels. Bound it by the remaining overall deadline.
        const attemptBudget = Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now()));
        const timer = setTimeout(() => controller.abort(), attemptBudget);
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
        if (Date.now() >= deadline) {
            break;
        }
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }
    throw new Error(lastError
        ? `${label} did not become healthy within ${timeoutMs}ms: ${lastError}`
        : `${label} did not become healthy within ${timeoutMs}ms`);
}
