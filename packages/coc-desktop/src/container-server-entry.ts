/**
 * Forked CoCContainer server entry for the Electron desktop product.
 */

interface ContainerServerHandle {
    port: number;
    close: () => Promise<void>;
}

type ResolveConfig = (overrides?: {
    serve?: { host?: string; port?: number; dataDir?: string };
}) => unknown;
type EnsureDataDir = (dataDir?: string) => void;
type CreateContainerServer = (config: unknown) => Promise<ContainerServerHandle>;

type ChildMessage =
    | { type: 'listening'; port: number }
    | { type: 'error'; message: string };

function send(message: ChildMessage): void {
    if (typeof process.send === 'function') {
        process.send(message);
    }
}

async function main(): Promise<void> {
    const host = process.env.COC_DESKTOP_HOST || '127.0.0.1';
    const port = Number(process.env.COC_DESKTOP_PORT) || 0;
    const dataDir = process.env.COC_DESKTOP_DATA_DIR;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveConfig, ensureDataDir } = require('@plusplusoneplusplus/coccontainer/dist/config') as {
        resolveConfig: ResolveConfig;
        ensureDataDir: EnsureDataDir;
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createContainerServer } = require('@plusplusoneplusplus/coccontainer/dist/server') as {
        createContainerServer: CreateContainerServer;
    };

    const config = resolveConfig({ serve: { host, port, dataDir } });
    ensureDataDir(dataDir);
    const server = await createContainerServer(config);
    send({ type: 'listening', port: server.port });

    let closing = false;
    const shutdown = async () => {
        if (closing) {
            return;
        }
        closing = true;
        await server.close();
        process.exit(0);
    };

    process.on('message', (message: unknown) => {
        if (message && typeof message === 'object' && (message as { type?: string }).type === 'shutdown') {
            void shutdown();
        }
    });
    process.on('disconnect', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
    process.on('SIGINT', () => { void shutdown(); });
}

main().catch((error: unknown) => {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
});
