/** Owned-server running-work check, independent of Electron dialogs. */
import type { ServerHandle } from './server-controller';

export interface UpdateRestartOptions {
    server: Pick<ServerHandle, 'started' | 'url'> | null;
    confirmRunningTasks(count: number): Promise<boolean>;
    fetchFn?: typeof fetch;
}

/** A cancelled confirmation leaves the coordinator's verified download ready. */
export async function confirmUpdateRestart(options: UpdateRestartOptions): Promise<boolean> {
    // An attached server survives desktop shutdown and must remain untouched.
    if (!options.server?.started) return true;

    let count: number;
    try {
        const signal = AbortSignal.timeout(10_000);
        // No repo filter: quitting our server affects every registered workspace.
        const response = await (options.fetchFn ?? globalThis.fetch)(
            new URL('/api/queue', options.server.url).href,
            { signal, redirect: 'error' },
        );
        if (!response.ok) {
            await response.body?.cancel();
            throw new Error(`HTTP ${response.status}`);
        }
        const queue: unknown = await response.json();
        signal.throwIfAborted();
        if (!queue || typeof queue !== 'object' || !('running' in queue) || !Array.isArray(queue.running)) {
            throw new Error('Invalid queue response: missing running tasks.');
        }
        count = queue.running.length;
    } catch (error) {
        // Unknown work must not be silently treated as an idle server.
        throw new Error(`Could not check running tasks before updating: ${error instanceof Error ? error.message : String(error)}`);
    }
    return count === 0 || options.confirmRunningTasks(count);
}
