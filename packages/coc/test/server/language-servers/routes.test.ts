/**
 * Behavior tests for the workspace-scoped language-server settings API.
 *
 * Handlers are invoked directly against the registered route table, the same
 * way the preferences routes are covered, so no HTTP server is needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import { registerLanguageServerRoutes } from '../../../src/server/language-servers';
import {
    getLanguageServerConfigPath,
    readLanguageServerConfig,
} from '../../../src/server/language-servers/repository';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';
import type { LanguageServerManager } from '../../../src/server/language-servers/manager';
import type { Route } from '../../../src/server/types';

const WORKSPACE = 'ws-lang';

function fakeReq(method: string, body: unknown): IncomingMessage {
    const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const readable = new Readable({ read() {} });
    readable.push(buf);
    readable.push(null);
    return Object.assign(readable, {
        method,
        headers: { 'content-type': 'application/json', 'content-length': String(buf.length) },
    }) as unknown as IncomingMessage;
}

function fakeRes() {
    const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        body: '',
        writeHead: vi.fn((code: number) => { res.statusCode = code; }),
        end: vi.fn((data: string) => { res.body = data; }),
        setHeader: vi.fn((k: string, v: string) => { res.headers[k] = v; }),
    };
    return res as unknown as ServerResponse & { statusCode: number; body: string };
}

function findRoute(routes: Route[], method: string, url: string): { route: Route; match: RegExpMatchArray } {
    for (const route of routes) {
        if (route.method !== method) {
            continue;
        }
        if (route.pattern instanceof RegExp) {
            const match = url.match(route.pattern);
            if (match) {
                return { route, match };
            }
        } else if (route.pattern === url) {
            return { route, match: [url] as unknown as RegExpMatchArray };
        }
    }
    throw new Error(`No route for ${method} ${url}`);
}

function customDefinition(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return {
        id: 'fixture',
        displayName: 'Fixture Server',
        languageIds: ['fixture'],
        filePatterns: ['**/*.fixture'],
        command: 'node',
        args: ['fixture-server.js', '--stdio'],
        rootMarkers: ['fixture.json'],
        enabled: true,
        ...overrides,
    };
}

describe('registerLanguageServerRoutes', () => {
    let dataDir: string;
    let routes: Route[];
    let runtimeManager: Pick<LanguageServerManager, 'listStates' | 'retry'> | undefined;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-lsp-routes-'));
        routes = [];
        runtimeManager = undefined;
        registerLanguageServerRoutes(routes, dataDir, () => runtimeManager as LanguageServerManager | undefined);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function call(method: string, workspaceId: string, body?: unknown) {
        const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/language-servers`;
        const found = findRoute(routes, method, url);
        const res = fakeRes();
        await found.route.handler(fakeReq(method, body ?? {}), res, found.match);
        return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : undefined };
    }

    it('GET returns all disabled built-in presets before anything is configured', async () => {
        const { status, json } = await call('GET', WORKSPACE);

        expect(status).toBe(200);
        expect(json.enabled).toBe(false);
        expect(json.definitions).toEqual([]);
        expect(json.status).toBe('missing');
        expect(json.effective.map((d: LanguageServerDefinition) => d.id)).toEqual([
            'typescript',
            'rust',
            'python',
            'clangd',
        ]);
        // Nothing may start while support is off, preset included.
        expect(json.startable).toEqual([]);
        expect(json.runtimes).toEqual([]);
    });

    it('GET exposes safe per-root runtime state without host paths', async () => {
        runtimeManager = {
            listStates: vi.fn(() => [{
                sessionId: 'session-1',
                workspaceId: WORKSPACE,
                projectRoot: 'crates/api',
                status: 'unavailable',
                definitionId: 'rust',
                displayName: 'Rust',
                detail: 'rust-analyzer is not installed',
                runtime: 'Server: rustup (stable)',
                recoveryCommand: 'rustup component add rust-analyzer',
                lastAttemptAt: '2026-09-12T05:00:00.000Z',
                restarts: 0,
                generation: 0,
                capabilities: { workspace: { privateFeature: true } },
            }]),
            retry: vi.fn(),
        };

        const { json } = await call('GET', WORKSPACE);

        expect(json.runtimes[0]).toMatchObject({
            projectRoot: 'crates/api',
            status: 'unavailable',
            recoveryCommand: 'rustup component add rust-analyzer',
        });
        expect(JSON.stringify(json.runtimes)).not.toContain(dataDir);
        expect(json.runtimes[0]).not.toHaveProperty('capabilities');
    });

    it('retries a workspace-owned session and returns its updated state', async () => {
        const retry = vi.fn().mockResolvedValue(true);
        runtimeManager = { listStates: vi.fn(() => []), retry };
        const url = `/api/workspaces/${WORKSPACE}/language-servers/retry`;
        const found = findRoute(routes, 'POST', url);
        const res = fakeRes();

        await found.route.handler(fakeReq('POST', { sessionId: 'session-1' }), res, found.match);

        expect(retry).toHaveBeenCalledWith(WORKSPACE, 'session-1');
        expect(res.statusCode).toBe(200);
    });

    it('PUT persists a custom definition for the target workspace only', async () => {
        const put = await call('PUT', WORKSPACE, { enabled: true, definitions: [customDefinition()] });
        expect(put.status).toBe(200);
        expect(put.json.enabled).toBe(true);
        expect(put.json.startable.map((d: LanguageServerDefinition) => d.id)).toEqual(['fixture']);

        // Reopening settings shows the saved definition.
        const reopened = await call('GET', WORKSPACE);
        expect(reopened.json.definitions).toHaveLength(1);
        expect(reopened.json.definitions[0].command).toBe('node');
        expect(reopened.json.status).toBe('ok');

        // A different workspace is untouched.
        const other = await call('GET', 'ws-other');
        expect(other.json.enabled).toBe(false);
        expect(other.json.definitions).toEqual([]);
    });

    it('PUT replaces omitted fields with their defaults', async () => {
        await call('PUT', WORKSPACE, { enabled: true, definitions: [customDefinition()] });

        const replaced = await call('PUT', WORKSPACE, {});

        expect(replaced.status).toBe(200);
        expect(replaced.json.enabled).toBe(false);
        expect(replaced.json.definitions).toEqual([]);
    });

    it('PATCH toggles enabled without disturbing stored definitions', async () => {
        await call('PUT', WORKSPACE, { enabled: true, definitions: [customDefinition()] });

        const patched = await call('PATCH', WORKSPACE, { enabled: false });

        expect(patched.status).toBe(200);
        expect(patched.json.enabled).toBe(false);
        expect(patched.json.definitions).toHaveLength(1);
        expect(patched.json.startable).toEqual([]);
    });

    it('PATCH can enable the TypeScript preset by overriding it', async () => {
        const patched = await call('PATCH', WORKSPACE, {
            enabled: true,
            definitions: [{ ...customDefinition(), id: 'typescript' }],
        });

        expect(patched.status).toBe(200);
        const startable = patched.json.startable as LanguageServerDefinition[];
        expect(startable).toHaveLength(1);
        expect(startable[0].id).toBe('typescript');
        // Overriding a preset keeps it marked as built-in and repoints the command.
        expect(startable[0].builtIn).toBe(true);
        expect(startable[0].command).toBe('node');
    });

    it('starts Python only when both workspace support and its preset are enabled', async () => {
        const python = customDefinition({
            id: 'python',
            displayName: 'Python',
            languageIds: ['python'],
            filePatterns: ['**/*.{py,pyi,pyw}'],
            command: 'pyright-langserver',
            args: ['--stdio'],
            rootMarkers: ['pyproject.toml'],
            enabled: true,
        });

        const presetOnly = await call('PUT', WORKSPACE, { enabled: false, definitions: [python] });
        expect(presetOnly.json.startable).toEqual([]);

        const enabled = await call('PATCH', WORKSPACE, { enabled: true });
        expect(enabled.json.startable.map((d: LanguageServerDefinition) => d.id)).toEqual(['python']);
        expect(enabled.json.startable[0].builtIn).toBe(true);

        const disabledPreset = await call('PATCH', WORKSPACE, {
            definitions: [{ ...python, enabled: false }],
        });
        expect(disabledPreset.json.startable).toEqual([]);
        expect(readLanguageServerConfig(dataDir, WORKSPACE).definitions[0].enabled).toBe(false);
    });

    it('rejects an invalid definition with field-level errors and keeps the last valid config', async () => {
        await call('PUT', WORKSPACE, { enabled: true, definitions: [customDefinition()] });

        const rejected = await call('PUT', WORKSPACE, {
            enabled: true,
            definitions: [customDefinition({ command: 'node --inspect && rm -rf /' })],
        });

        expect(rejected.status).toBe(400);
        expect(rejected.json.errors.length).toBeGreaterThan(0);
        expect(rejected.json.errors[0].field).toBe('definitions.0.command');
        expect(rejected.json.config.definitions[0].command).toBe('node');
        // Disk still holds the previous valid configuration.
        expect(readLanguageServerConfig(dataDir, WORKSPACE).definitions[0].command).toBe('node');
    });

    it('rejects a non-boolean enabled and a non-array definitions list', async () => {
        const badEnabled = await call('PUT', WORKSPACE, { enabled: 'yes' });
        expect(badEnabled.status).toBe(400);
        expect(badEnabled.json.errors[0].field).toBe('enabled');

        const badDefinitions = await call('PUT', WORKSPACE, { definitions: { id: 'fixture' } });
        expect(badDefinitions.status).toBe(400);
        expect(badDefinitions.json.errors[0].field).toBe('definitions');

        // Neither attempt created a config file.
        expect(fs.existsSync(getLanguageServerConfigPath(dataDir, WORKSPACE))).toBe(false);
    });

    it('rejects a non-object body', async () => {
        const url = `/api/workspaces/${WORKSPACE}/language-servers`;
        const found = findRoute(routes, 'PUT', url);
        const res = fakeRes();
        await found.route.handler(fakeReq('PUT', [customDefinition()]), res, found.match);

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body).error).toMatch(/JSON object/);
    });

    it('rejects a malformed JSON body', async () => {
        const url = `/api/workspaces/${WORKSPACE}/language-servers`;
        const found = findRoute(routes, 'PUT', url);
        const res = fakeRes();
        await found.route.handler(fakeReq('PUT', '{not json'), res, found.match);

        expect(res.statusCode).toBe(400);
    });

    it('GET reports a corrupt config file as invalid without leaking the file path', async () => {
        const filePath = getLanguageServerConfigPath(dataDir, WORKSPACE);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '{ broken', 'utf-8');

        const { status, json } = await call('GET', WORKSPACE);

        expect(status).toBe(200);
        expect(json.status).toBe('invalid');
        expect(json.enabled).toBe(false);
        expect(json.warnings).toHaveLength(1);
        expect(json.warnings[0]).not.toHaveProperty('filePath');
    });

    it('routes a workspace id that needs URL encoding to that workspace', async () => {
        const encodedWorkspace = 'ws with space';

        const put = await call('PUT', encodedWorkspace, { enabled: true, definitions: [customDefinition()] });
        expect(put.status).toBe(200);

        expect(readLanguageServerConfig(dataDir, encodedWorkspace).definitions).toHaveLength(1);
        expect(readLanguageServerConfig(dataDir, WORKSPACE).definitions).toHaveLength(0);
    });
});
