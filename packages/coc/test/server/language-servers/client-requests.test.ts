/**
 * Built-in answers to server-to-client requests.
 *
 * The unit cases cover section resolution and the registration bookkeeping;
 * the integration cases drive a real fixture process, which asks the client
 * the same questions a standard server asks, so a pass proves the session
 * installs the handlers on every connection rather than answering -32601.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
    DEFAULT_CLIENT_CAPABILITIES,
    LanguageServerClientRequests,
    resolveConfigurationSection,
} from '../../../src/server/language-servers/client-requests';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import type { LanguageServerDefinition, JsonValue } from '../../../src/server/language-servers/types';

const FIXTURE_SERVER = path.join(__dirname, 'fixtures', 'echo-language-server.mjs');

const sessions: LanguageServerSession[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.dispose()));
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function tempRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-lsp-client-'));
    tempDirs.push(dir);
    return dir;
}

function fixtureDefinition(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return {
        id: 'echo',
        displayName: 'Echo Test Server',
        languageIds: ['plaintext'],
        filePatterns: ['**/*.txt'],
        command: process.execPath,
        args: [FIXTURE_SERVER],
        rootMarkers: ['package.json'],
        ...overrides,
    };
}

function createSession(definition: LanguageServerDefinition, rootPath?: string): LanguageServerSession {
    const session = new LanguageServerSession({
        definition,
        rootPath: rootPath ?? tempRoot(),
        requestTimeoutMs: 5_000,
        startTimeoutMs: 5_000,
    });
    sessions.push(session);
    return session;
}

/** Asks the fixture to send `method` to the client and returns the reply. */
async function ask(
    session: LanguageServerSession,
    method: string,
    params?: unknown,
): Promise<{ value: unknown; error: { code: number; message: string } | null }> {
    return session.sendRequest('ask', { method, params });
}

function clientRequests(settings?: JsonValue): LanguageServerClientRequests {
    return new LanguageServerClientRequests({
        settings,
        workspaceFolders: () => [{ uri: 'file:///root', name: 'root' }],
    });
}

describe('resolveConfigurationSection', () => {
    const settings: JsonValue = {
        typescript: { inlayHints: { enabled: true }, preferences: { quoteStyle: 'single' } },
        top: 'value',
    };

    it('returns the whole settings object when no section is asked for', () => {
        expect(resolveConfigurationSection(settings)).toEqual(settings);
        expect(resolveConfigurationSection(settings, '')).toEqual(settings);
    });

    it('walks a dotted section path', () => {
        expect(resolveConfigurationSection(settings, 'top')).toBe('value');
        expect(resolveConfigurationSection(settings, 'typescript.inlayHints')).toEqual({ enabled: true });
        expect(resolveConfigurationSection(settings, 'typescript.preferences.quoteStyle')).toBe('single');
    });

    it('returns null for a missing path rather than throwing', () => {
        expect(resolveConfigurationSection(settings, 'missing')).toBeNull();
        expect(resolveConfigurationSection(settings, 'typescript.missing.deeper')).toBeNull();
        // `top` is a string, so descending into it has no value.
        expect(resolveConfigurationSection(settings, 'top.deeper')).toBeNull();
    });

    it('returns null when the definition carries no settings', () => {
        expect(resolveConfigurationSection(undefined, 'typescript')).toBeNull();
        expect(resolveConfigurationSection(undefined)).toBeNull();
    });
});

describe('LanguageServerClientRequests', () => {
    it('answers one configuration value per requested item, in order', async () => {
        const handlers = clientRequests({ a: { b: 1 }, c: 2 }).handlers();
        const result = await handlers.get('workspace/configuration')!({
            items: [{ section: 'a.b' }, { section: 'c' }, { section: 'missing' }, {}],
        });
        expect(result).toEqual([1, 2, null, { a: { b: 1 }, c: 2 }]);
    });

    it('answers an empty list when the request carries no items', async () => {
        const handlers = clientRequests({ a: 1 }).handlers();
        expect(await handlers.get('workspace/configuration')!({})).toEqual([]);
        expect(await handlers.get('workspace/configuration')!(undefined)).toEqual([]);
    });

    it('reads workspace folders at request time', async () => {
        let folders = [{ uri: 'file:///one', name: 'one' }];
        const requests = new LanguageServerClientRequests({ workspaceFolders: () => folders });
        const handlers = requests.handlers();
        expect(await handlers.get('workspace/workspaceFolders')!(undefined)).toEqual(folders);
        folders = [{ uri: 'file:///two', name: 'two' }];
        expect(await handlers.get('workspace/workspaceFolders')!(undefined)).toEqual(folders);
    });

    it('records and removes dynamic registrations', async () => {
        const changes: number[] = [];
        const requests = new LanguageServerClientRequests({
            workspaceFolders: () => [],
            onRegistrationsChanged: (registrations) => changes.push(registrations.length),
        });
        const handlers = requests.handlers();
        expect(
            await handlers.get('client/registerCapability')!({
                registrations: [
                    { id: 'r1', method: 'textDocument/hover' },
                    { id: 'r2', method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers: [] } },
                    { id: 7, method: 'bad' },
                ],
            }),
        ).toBeNull();
        expect(requests.getRegistrations()).toEqual([
            { id: 'r1', method: 'textDocument/hover', registerOptions: undefined },
            { id: 'r2', method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers: [] } },
        ]);
        expect(requests.hasRegistration('textDocument/hover')).toBe(true);
        expect(requests.hasRegistration('textDocument/rename')).toBe(false);

        await handlers.get('client/unregisterCapability')!({ unregisterations: [{ id: 'r1' }] });
        expect(requests.hasRegistration('textDocument/hover')).toBe(false);
        // Both spellings of the field are accepted.
        await handlers.get('client/unregisterCapability')!({ unregistrations: [{ id: 'r2' }] });
        expect(requests.getRegistrations()).toEqual([]);
        expect(changes).toEqual([2, 1, 0]);
    });

    it('accepts a work-done progress create request', async () => {
        const handlers = clientRequests().handlers();
        expect(await handlers.get('window/workDoneProgress/create')!({ token: 'x' })).toBeNull();
    });

    it('clears registrations on reset, notifying only when something was held', () => {
        const changes: number[] = [];
        const requests = new LanguageServerClientRequests({
            workspaceFolders: () => [],
            onRegistrationsChanged: (registrations) => changes.push(registrations.length),
        });
        requests.reset();
        expect(changes).toEqual([]);
        void requests.handlers().get('client/registerCapability')!({ registrations: [{ id: 'r', method: 'm' }] });
        requests.reset();
        expect(changes).toEqual([1, 0]);
        expect(requests.getRegistrations()).toEqual([]);
    });
});

describe('LanguageServerSession client requests', () => {
    it('advertises the default client capabilities in initialize', async () => {
        const session = createSession(fixtureDefinition());
        await session.start();
        const init = await session.sendRequest<{ params: { capabilities: Record<string, unknown> } }>('getInit');
        expect(init.params.capabilities).toEqual(DEFAULT_CLIENT_CAPABILITIES);
    });

    it('lets a caller replace the advertised capabilities', async () => {
        const session = new LanguageServerSession({
            definition: fixtureDefinition(),
            rootPath: tempRoot(),
            clientCapabilities: { workspace: { configuration: false } },
            startTimeoutMs: 5_000,
        });
        sessions.push(session);
        await session.start();
        const init = await session.sendRequest<{ params: { capabilities: unknown } }>('getInit');
        expect(init.params.capabilities).toEqual({ workspace: { configuration: false } });
    });

    it('answers workspace/configuration from the definition settings', async () => {
        const session = createSession(
            fixtureDefinition({ settings: { echo: { level: 'verbose' }, other: 1 } }),
        );
        await session.start();
        const reply = await ask(session, 'workspace/configuration', {
            items: [{ section: 'echo.level' }, { section: 'nope' }],
        });
        expect(reply.error).toBeNull();
        expect(reply.value).toEqual(['verbose', null]);
    });

    it('answers workspace/workspaceFolders with the resolved project root', async () => {
        const root = tempRoot();
        const session = createSession(fixtureDefinition(), root);
        await session.start();
        const reply = await ask(session, 'workspace/workspaceFolders');
        expect(reply.value).toEqual([{ uri: pathToFileURL(path.resolve(root)).href, name: path.basename(root) }]);
    });

    it('records capabilities the server registers dynamically and reports them in state', async () => {
        const session = createSession(fixtureDefinition());
        await session.start();
        await ask(session, 'client/registerCapability', {
            registrations: [{ id: 'watch', method: 'workspace/didChangeWatchedFiles' }],
        });
        expect(session.getDynamicRegistrations()).toEqual([
            { id: 'watch', method: 'workspace/didChangeWatchedFiles', registerOptions: undefined },
        ]);
        expect(session.getState().dynamicRegistrations).toHaveLength(1);

        await ask(session, 'client/unregisterCapability', { unregisterations: [{ id: 'watch' }] });
        expect(session.getDynamicRegistrations()).toEqual([]);
    });

    it('drops registrations from a previous process after a restart', async () => {
        const session = createSession(fixtureDefinition());
        await session.start();
        await ask(session, 'client/registerCapability', {
            registrations: [{ id: 'watch', method: 'workspace/didChangeWatchedFiles' }],
        });
        expect(session.getDynamicRegistrations()).toHaveLength(1);

        await session.restart();
        expect(session.getDynamicRegistrations()).toEqual([]);
        expect(session.getState().dynamicRegistrations).toEqual([]);
        // The handlers are reinstalled on the new connection, not lost with the old one.
        const reply = await ask(session, 'window/workDoneProgress/create', { token: 'after-restart' });
        expect(reply.error).toBeNull();
        expect(reply.value).toBeNull();
    });

    it('still refuses a request nothing handles', async () => {
        const session = createSession(fixtureDefinition());
        await session.start();
        const reply = await ask(session, 'window/showDocument', { uri: 'file:///etc/passwd' });
        expect(reply.error).toMatchObject({ code: -32601 });
    });

    it("lets a caller's own handler override a built-in answer", async () => {
        const session = createSession(fixtureDefinition({ settings: { echo: 1 } }));
        session.onRequest('workspace/configuration', () => ['overridden']);
        await session.start();
        const reply = await ask(session, 'workspace/configuration', { items: [{ section: 'echo' }] });
        expect(reply.value).toEqual(['overridden']);
    });
});
