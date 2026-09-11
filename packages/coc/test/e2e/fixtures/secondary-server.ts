/**
 * A second, independent CoC server in the same process, standing in for a
 * machine reached over SSH or a tunnel.
 *
 * Direct remote clones are routed by origin, not by transport: the browser
 * talks straight to the owning server's `baseUrl`. A second server on its own
 * port and data dir is therefore a faithful remote host for anything that has
 * to prove a request landed on the right machine, and it needs no real network.
 *
 * Used by the remote removal-routing suite and by the direct-remote language
 * cases in explorer-lsp.spec.ts.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, type Page } from '@playwright/test';
import { safeRmSync } from '../../helpers/safe-rm';
import { createE2EMockSDKService } from './mock-ai';
import { E2E_SERVER_CONFIG_YAML } from './e2e-server-config';
import { request } from './seed';

// Same dist import style as the server fixture — Playwright doesn't transpile src TS.
const { createExecutionServer } = require('../../../dist/server/index');
const { FileProcessStore } = require('@plusplusoneplusplus/forge');

/** A second, independent CoC server standing in for the remote host. */
export interface SecondaryServer {
    url: string;
    dataDir: string;
    /** Stop the HTTP server (the temp dir stays until `cleanup`). */
    stop(): Promise<void>;
    /** Stop if still running, then remove the temp dir. */
    cleanup(): Promise<void>;
}

/**
 * Boot a second CoC server on its own port + data dir. Mirrors the primary
 * fixture's setup (mock AI, isolated config, pre-dismissed onboarding) so the
 * remote behaves like a real peer rather than a stub.
 */
export async function startSecondaryServer(): Promise<SecondaryServer> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-e2e-remote-'));
    fs.writeFileSync(
        path.join(dataDir, 'preferences.json'),
        JSON.stringify({ global: { hasSeenWelcome: true } }),
    );
    const configPath = path.join(dataDir, 'config.yaml');
    fs.writeFileSync(configPath, E2E_SERVER_CONFIG_YAML);

    const server = await createExecutionServer({
        store: new FileProcessStore({ dataDir }),
        port: 0,
        host: '127.0.0.1',
        dataDir,
        aiService: createE2EMockSDKService().service,
        configPath,
    });

    let stopped = false;
    const stop = async () => {
        if (stopped) return;
        stopped = true;
        await server.close();
    };
    return {
        url: server.url,
        dataDir,
        stop,
        cleanup: async () => {
            await stop();
            await new Promise(r => setTimeout(r, process.platform === 'win32' ? 500 : 0));
            safeRmSync(dataDir);
        },
    };
}

/** Force the remote-first shell on (the shared E2E config pins it off). */
export async function enableRemoteShell(page: Page): Promise<void> {
    await page.route('**/api/config/runtime', async (route) => {
        try {
            const resp = await route.fetch();
            const json = await resp.json();
            const features = { ...(json.features ?? {}), remoteShellEnabled: true };
            await route.fulfill({
                status: resp.status(),
                headers: { ...resp.headers(), 'content-type': 'application/json' },
                body: JSON.stringify({ ...json, features }),
            });
        } catch {
            await route.continue().catch(() => {});
        }
    });
}

/** Register `remoteUrl` on `serverUrl` as a `url`-kind remote server. */
export async function registerRemoteServer(
    serverUrl: string,
    label: string,
    remoteUrl: string,
): Promise<{ id: string; status?: string }> {
    const res = await request(`${serverUrl}/api/servers`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'url', label, url: remoteUrl }),
    });
    expect(res.status, `POST /api/servers -> ${res.body}`).toBe(201);
    return JSON.parse(res.body) as { id: string; status?: string };
}

/** Runtime status the primary server currently reports for a registered remote. */
export async function remoteServerStatus(serverUrl: string, id: string): Promise<string> {
    const res = await request(`${serverUrl}/api/servers`);
    if (res.status !== 200) return '';
    const list = JSON.parse(res.body) as Array<{ id: string; status?: string }>;
    return String(list.find(s => s.id === id)?.status ?? '');
}
