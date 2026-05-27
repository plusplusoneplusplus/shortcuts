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

    const displayHost = config.serve.host === '0.0.0.0' || config.serve.host === '127.0.0.1' ? 'localhost' : config.serve.host;
    const url = `http://${displayHost}:${config.serve.port}`;
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
            server.close();
            resolve();
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

    // Force exit — open SSE/WS connections may keep the event loop alive
    process.exit(0);
}
