/**
 * Serve command — starts the CoCContainer aggregation dashboard.
 */

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

    const url = `http://${config.serve.host}:${config.serve.port}`;
    console.log(`CoCContainer dashboard running at ${url}`);

    if (opts.open !== false) {
        const { exec } = await import('child_process');
        const cmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${cmd} ${url}`);
    }

    // Keep alive
    await new Promise<void>((resolve) => {
        process.on('SIGINT', () => {
            console.log('\nShutting down...');
            server.close();
            resolve();
        });
        process.on('SIGTERM', () => {
            server.close();
            resolve();
        });
    });
}
