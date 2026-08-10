/**
 * Serve command — starts the CoCContainer aggregation dashboard.
 */

import * as readline from 'readline';
import { resolveConfig, ensureDataDir, type ResolvedContainerConfig } from '../config';
import { createContainerServer } from '../server';

export async function executeServe(opts: {
    port?: string;
    host?: string;
    dataDir?: string;
    open?: boolean;
}): Promise<void> {
    const config = resolveConfig({
        serve: {
            port: opts.port ? parseInt(opts.port, 10) : undefined,
            host: opts.host,
            dataDir: opts.dataDir,
        },
    });

    ensureDataDir(config.serve.dataDir);

    const server = await createContainerServer(config);

    const url = server.url;
    console.log(`CoCContainer dashboard running at ${url}`);

    if (opts.open !== false) {
        const { exec } = await import('child_process');
        const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${cmd} ${url}`);
    }

    // Keep alive until shutdown signal
    await new Promise<void>((resolve) => {
        const onSignal = () => {
            console.log('\nShutting down...');
            void server.close().then(resolve, (error: unknown) => {
                console.error(`Failed to close CoCContainer cleanly: ${error instanceof Error ? error.message : String(error)}`);
                resolve();
            });
        };

        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);

        // On Windows, SIGINT may not fire in all terminal environments.
        // Use readline interface to reliably capture Ctrl+C.
        if (process.platform === 'win32') {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl.on('SIGINT', onSignal);
            rl.on('close', onSignal);
        }
    });

    process.exit(0);
}
