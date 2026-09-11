/**
 * Session manager behavior: one session per workspace, browser editing
 * session, definition, and project root; reference-counted release; bounded
 * live sessions; replacement on configuration change; and full teardown on
 * workspace removal and shutdown.
 *
 * Config is written through the real repository so the change events are the
 * ones production emits. Sessions are real `LanguageServerSession` objects
 * unless a case needs to observe disposal, and none of them spawn a process
 * until something sends a request.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LanguageServerManager } from '../../../src/server/language-servers/manager';
import type { SessionClosedEvent } from '../../../src/server/language-servers/manager';
import { LanguageServerSession } from '../../../src/server/language-servers/session';
import type { LanguageServerSessionOptions } from '../../../src/server/language-servers/session';
import { writeLanguageServerConfig } from '../../../src/server/language-servers/repository';
import type { PrepareDefinitionDeps } from '../../../src/server/language-servers/adapters';
import { RUST_PRESET, TYPESCRIPT_PRESET } from '../../../src/server/language-servers/presets';
import type { LanguageServerDefinition } from '../../../src/server/language-servers/types';

const FIXTURE_SERVER = path.join(__dirname, 'fixtures', 'echo-language-server.mjs');

const managers: LanguageServerManager[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.dispose()));
    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function echoDefinition(overrides: Partial<LanguageServerDefinition> = {}): LanguageServerDefinition {
    return {
        id: 'echo',
        displayName: 'Echo Test Server',
        languageIds: ['plaintext'],
        filePatterns: ['**/*.txt'],
        command: process.execPath,
        args: [FIXTURE_SERVER],
        rootMarkers: ['package.json'],
        enabled: true,
        ...overrides,
    };
}

interface Harness {
    manager: LanguageServerManager;
    dataDir: string;
    workspaceRoot: string;
    created: LanguageServerSessionOptions[];
    disposed: string[];
    closed: SessionClosedEvent[];
    setConfig: (definitions: LanguageServerDefinition[], enabled?: boolean) => void;
}

function createHarness(
    definitions: LanguageServerDefinition[] = [echoDefinition()],
    options: {
        maxSessions?: number;
        enabled?: boolean;
        exists?: (candidate: string) => boolean;
        prepareDeps?: PrepareDefinitionDeps;
    } = {},
): Harness {
    const dataDir = tempDir('coc-lsp-manager-data-');
    const workspaceRoot = tempDir('coc-lsp-manager-repo-');
    const created: LanguageServerSessionOptions[] = [];
    const disposed: string[] = [];
    const closed: SessionClosedEvent[] = [];
    const workspaceId = 'ws-a';

    const write = (defs: LanguageServerDefinition[], enabled = true): void => {
        const result = writeLanguageServerConfig(dataDir, workspaceId, { enabled, definitions: defs });
        expect(result.ok).toBe(true);
    };
    write(definitions, options.enabled ?? true);

    const manager = new LanguageServerManager({
        dataDir,
        maxSessions: options.maxSessions,
        exists: options.exists,
        prepareDeps: options.prepareDeps,
        createSession: (sessionOptions) => {
            created.push(sessionOptions);
            const session = new LanguageServerSession(sessionOptions);
            const originalDispose = session.dispose.bind(session);
            session.dispose = async (): Promise<void> => {
                disposed.push(sessionOptions.definition.id);
                await originalDispose();
            };
            return session;
        },
    });
    managers.push(manager);
    manager.onSessionClosed((event) => closed.push(event));

    return { manager, dataDir, workspaceRoot, created, disposed, closed, setConfig: write };
}

function acquireTxt(
    harness: Harness,
    editingSessionId: string,
    relativePath = 'src/notes.txt',
    workspaceId = 'ws-a',
): ReturnType<LanguageServerManager['acquire']> {
    return harness.manager.acquire({
        workspaceId,
        workspaceRoot: harness.workspaceRoot,
        editingSessionId,
        relativePath,
    });
}

describe('LanguageServerManager selection', () => {
    it('starts one session for a document and reports the resolved definition', () => {
        const harness = createHarness();
        const result = acquireTxt(harness, 'browser-1');
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.handle.definition.id).toBe('echo');
        expect(result.handle.languageId).toBe('plaintext');
        expect(result.handle.rootPath).toBe(path.resolve(harness.workspaceRoot));
        expect(harness.manager.size).toBe(1);
    });

    it('reports language support off when the workspace has it disabled', () => {
        const harness = createHarness([echoDefinition()], { enabled: false });
        const result = acquireTxt(harness, 'browser-1');
        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }
        expect(result.reason).toBe('disabled');
        expect(harness.manager.size).toBe(0);
    });

    it('reports no definition when nothing claims the file', () => {
        const harness = createHarness();
        const result = acquireTxt(harness, 'browser-1', 'src/main.rs');
        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }
        expect(result.reason).toBe('no-definition');
    });

    it('resolves the language id from the definition extension map', () => {
        const harness = createHarness([
            echoDefinition({
                filePatterns: ['**/*.{txt,md}'],
                languageIds: ['plaintext', 'markdown'],
                extensionLanguageIds: { '.md': 'markdown' },
            }),
        ]);
        const result = acquireTxt(harness, 'browser-1', 'docs/readme.md');
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.handle.languageId).toBe('markdown');
    });
});

describe('LanguageServerManager session identity', () => {
    it('reuses one session for two documents in the same editing session', () => {
        const harness = createHarness();
        const first = acquireTxt(harness, 'browser-1', 'a.txt');
        const second = acquireTxt(harness, 'browser-1', 'b.txt');
        expect(first.ok && second.ok).toBe(true);
        if (!first.ok || !second.ok) {
            return;
        }
        expect(second.handle.session).toBe(first.handle.session);
        expect(harness.manager.size).toBe(1);
        expect(harness.created).toHaveLength(1);
    });

    it('isolates sessions across separate browser editing sessions', () => {
        const harness = createHarness();
        const first = acquireTxt(harness, 'browser-1');
        const second = acquireTxt(harness, 'browser-2');
        expect(first.ok && second.ok).toBe(true);
        if (!first.ok || !second.ok) {
            return;
        }
        expect(second.handle.session).not.toBe(first.handle.session);
        expect(second.handle.key).not.toBe(first.handle.key);
        expect(harness.manager.size).toBe(2);
    });

    it('gives each project root its own session within one editing session', () => {
        const harness = createHarness([echoDefinition()], {
            exists: (candidate) => candidate.includes(`packages${path.sep}app${path.sep}package.json`),
        });
        const outer = acquireTxt(harness, 'browser-1', 'notes.txt');
        const inner = acquireTxt(harness, 'browser-1', 'packages/app/notes.txt');
        expect(outer.ok && inner.ok).toBe(true);
        if (!outer.ok || !inner.ok) {
            return;
        }
        expect(inner.handle.rootPath).toBe(path.join(path.resolve(harness.workspaceRoot), 'packages', 'app'));
        expect(inner.handle.session).not.toBe(outer.handle.session);
        expect(harness.manager.size).toBe(2);
    });

    it('reuses one Rust session across Cargo workspace crates and isolates a standalone crate', () => {
        const harness = createHarness([{ ...RUST_PRESET, enabled: true }], {
            prepareDeps: {
                runRustupWhich: () => undefined,
                resolveOnPath: () => undefined,
            },
        });
        const cargoWorkspace = path.join(harness.workspaceRoot, 'rust-workspace');
        const firstCrate = path.join(cargoWorkspace, 'crates', 'first');
        const secondCrate = path.join(cargoWorkspace, 'crates', 'second');
        const standalone = path.join(harness.workspaceRoot, 'standalone');
        for (const directory of [firstCrate, secondCrate, standalone]) {
            fs.mkdirSync(path.join(directory, 'src'), { recursive: true });
            fs.writeFileSync(path.join(directory, 'Cargo.toml'), '[package]\nname = "fixture"\n');
        }
        fs.writeFileSync(path.join(cargoWorkspace, 'Cargo.toml'), '[workspace]\nmembers = ["crates/*"]\n');

        const first = harness.manager.acquire({
            workspaceId: 'ws-a',
            workspaceRoot: harness.workspaceRoot,
            editingSessionId: 'browser-1',
            relativePath: 'rust-workspace/crates/first/src/lib.rs',
        });
        const second = harness.manager.acquire({
            workspaceId: 'ws-a',
            workspaceRoot: harness.workspaceRoot,
            editingSessionId: 'browser-1',
            relativePath: 'rust-workspace\\crates\\second\\src\\lib.rs',
        });
        const separate = harness.manager.acquire({
            workspaceId: 'ws-a',
            workspaceRoot: harness.workspaceRoot,
            editingSessionId: 'browser-1',
            relativePath: 'standalone/src/lib.rs',
        });

        expect(first.ok && second.ok && separate.ok).toBe(true);
        if (!first.ok || !second.ok || !separate.ok) {
            return;
        }
        expect(first.handle.rootPath).toBe(cargoWorkspace);
        expect(second.handle.rootPath).toBe(cargoWorkspace);
        expect(second.handle.session).toBe(first.handle.session);
        expect(separate.handle.rootPath).toBe(standalone);
        expect(separate.handle.session).not.toBe(first.handle.session);
        expect(harness.manager.size).toBe(2);
    });

    it('keeps workspaces apart even when the relative path matches', () => {
        const harness = createHarness();
        const other = tempDir('coc-lsp-manager-repo-b-');
        writeLanguageServerConfig(harness.dataDir, 'ws-b', {
            enabled: true,
            definitions: [echoDefinition()],
        });
        const first = acquireTxt(harness, 'browser-1', 'src/notes.txt', 'ws-a');
        const second = harness.manager.acquire({
            workspaceId: 'ws-b',
            workspaceRoot: other,
            editingSessionId: 'browser-1',
            relativePath: 'src/notes.txt',
        });
        expect(first.ok && second.ok).toBe(true);
        if (!first.ok || !second.ok) {
            return;
        }
        expect(second.handle.session).not.toBe(first.handle.session);
        expect(harness.manager.listStates('ws-b')).toHaveLength(1);
        expect(harness.manager.listStates('ws-a')).toHaveLength(1);
    });
});

describe('LanguageServerManager capacity', () => {
    it('evicts the least recently used unreferenced session at the bound', () => {
        const harness = createHarness([echoDefinition()], { maxSessions: 2 });
        const first = acquireTxt(harness, 'browser-1');
        const second = acquireTxt(harness, 'browser-2');
        expect(first.ok && second.ok).toBe(true);
        if (!first.ok || !second.ok) {
            return;
        }
        first.handle.release();
        const third = acquireTxt(harness, 'browser-3');
        expect(third.ok).toBe(true);
        expect(harness.manager.size).toBe(2);
        expect(harness.closed.map((event) => event.reason)).toEqual(['evicted']);
        expect(harness.closed[0].editingSessionId).toBe('browser-1');
    });

    it('refuses a new session rather than evicting one a document still holds', () => {
        const harness = createHarness([echoDefinition()], { maxSessions: 1 });
        const first = acquireTxt(harness, 'browser-1');
        expect(first.ok).toBe(true);
        const second = acquireTxt(harness, 'browser-2');
        expect(second.ok).toBe(false);
        if (second.ok) {
            return;
        }
        expect(second.reason).toBe('capacity');
        expect(harness.manager.size).toBe(1);
    });

    it('frees capacity again once every view releases its handle', () => {
        const harness = createHarness([echoDefinition()], { maxSessions: 1 });
        const a = acquireTxt(harness, 'browser-1', 'a.txt');
        const b = acquireTxt(harness, 'browser-1', 'b.txt');
        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) {
            return;
        }
        a.handle.release();
        expect(acquireTxt(harness, 'browser-2').ok).toBe(false);
        b.handle.release();
        expect(acquireTxt(harness, 'browser-2').ok).toBe(true);
    });

    it('ignores a repeated release so one view cannot free another view\'s reference', () => {
        const harness = createHarness([echoDefinition()], { maxSessions: 1 });
        const a = acquireTxt(harness, 'browser-1', 'a.txt');
        const b = acquireTxt(harness, 'browser-1', 'b.txt');
        expect(a.ok && b.ok).toBe(true);
        if (!a.ok || !b.ok) {
            return;
        }
        a.handle.release();
        a.handle.release();
        const blocked = acquireTxt(harness, 'browser-2');
        expect(blocked.ok).toBe(false);
        void b;
    });
});

describe('LanguageServerManager configuration changes', () => {
    it('replaces a session when its definition changes', async () => {
        const harness = createHarness();
        const first = acquireTxt(harness, 'browser-1');
        expect(first.ok).toBe(true);
        harness.setConfig([echoDefinition({ args: [FIXTURE_SERVER, '--verbose'] })]);
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.closed.map((event) => event.reason)).toEqual(['config-changed']);
        expect(harness.disposed).toEqual(['echo']);
        expect(harness.manager.size).toBe(0);

        const second = acquireTxt(harness, 'browser-1');
        expect(second.ok).toBe(true);
        if (!second.ok || !first.ok) {
            return;
        }
        expect(second.handle.session).not.toBe(first.handle.session);
        expect(second.handle.definition.args).toEqual([FIXTURE_SERVER, '--verbose']);
    });

    it('keeps a running session when an unrelated definition is added', async () => {
        const harness = createHarness();
        const first = acquireTxt(harness, 'browser-1');
        expect(first.ok).toBe(true);
        harness.setConfig([
            echoDefinition(),
            echoDefinition({ id: 'other', filePatterns: ['**/*.log'] }),
        ]);
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.closed).toHaveLength(0);
        expect(harness.manager.size).toBe(1);
    });

    it('closes a session when language support is turned off', async () => {
        const harness = createHarness();
        expect(acquireTxt(harness, 'browser-1').ok).toBe(true);
        harness.setConfig([echoDefinition()], false);
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.manager.size).toBe(0);
        expect(harness.closed[0]?.reason).toBe('config-changed');
    });

    it('leaves another workspace alone when one workspace is reconfigured', async () => {
        const harness = createHarness();
        const other = tempDir('coc-lsp-manager-repo-c-');
        writeLanguageServerConfig(harness.dataDir, 'ws-b', {
            enabled: true,
            definitions: [echoDefinition()],
        });
        expect(acquireTxt(harness, 'browser-1').ok).toBe(true);
        const second = harness.manager.acquire({
            workspaceId: 'ws-b',
            workspaceRoot: other,
            editingSessionId: 'browser-1',
            relativePath: 'src/notes.txt',
        });
        expect(second.ok).toBe(true);
        harness.setConfig([echoDefinition({ args: [FIXTURE_SERVER, '--changed'] })]);
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.manager.listStates('ws-a')).toHaveLength(0);
        expect(harness.manager.listStates('ws-b')).toHaveLength(1);
    });
});

describe('LanguageServerManager teardown', () => {
    it('drops every session of a removed workspace and keeps the others', async () => {
        const harness = createHarness();
        const other = tempDir('coc-lsp-manager-repo-d-');
        writeLanguageServerConfig(harness.dataDir, 'ws-b', {
            enabled: true,
            definitions: [echoDefinition()],
        });
        acquireTxt(harness, 'browser-1');
        acquireTxt(harness, 'browser-2');
        harness.manager.acquire({
            workspaceId: 'ws-b',
            workspaceRoot: other,
            editingSessionId: 'browser-1',
            relativePath: 'src/notes.txt',
        });
        await harness.manager.disposeWorkspace('ws-a');
        expect(harness.manager.size).toBe(1);
        expect(harness.closed.map((event) => event.reason)).toEqual([
            'workspace-removed',
            'workspace-removed',
        ]);
        expect(harness.manager.listStates('ws-b')).toHaveLength(1);
    });

    it('drops only the sessions of one browser editing session', async () => {
        const harness = createHarness();
        acquireTxt(harness, 'browser-1');
        acquireTxt(harness, 'browser-2');
        await harness.manager.disposeEditingSession('ws-a', 'browser-1');
        const remaining = harness.manager.listStates('ws-a');
        expect(remaining).toHaveLength(1);
        expect(harness.closed).toHaveLength(1);
    });

    it('disposes every session and stops listening for config changes on shutdown', async () => {
        const harness = createHarness();
        acquireTxt(harness, 'browser-1');
        acquireTxt(harness, 'browser-2');
        await harness.manager.dispose();
        expect(harness.manager.size).toBe(0);
        expect(harness.disposed).toEqual(['echo', 'echo']);

        harness.setConfig([echoDefinition({ args: [FIXTURE_SERVER, '--after-shutdown'] })]);
        await Promise.resolve();
        await Promise.resolve();
        expect(harness.manager.size).toBe(0);
        const afterShutdown = acquireTxt(harness, 'browser-3');
        expect(afterShutdown.ok).toBe(false);
    });
});

describe('LanguageServerManager live process', () => {
    it('serves a request through the session it handed out and stops it on dispose', async () => {
        const harness = createHarness();
        const result = acquireTxt(harness, 'browser-1');
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const echoed = await result.handle.session.sendRequest<{ value: string }>('echo', { value: 'hi' });
        expect(echoed.value).toBe('hi');
        expect(result.handle.session.isReady).toBe(true);
        expect(harness.manager.listStates('ws-a')[0].status).toBe('ready');

        await harness.manager.dispose();
        expect(result.handle.session.isDisposed).toBe(true);
    });
});

describe('LanguageServerManager runtime preparation', () => {
    const nodePath = path.join(path.sep, 'usr', 'bin', 'node');

    /** A fake host where the workspace has both the server and TypeScript. */
    function typescriptDeps(workspaceRoot: string): PrepareDefinitionDeps {
        const root = path.resolve(workspaceRoot);
        const cli = path.join(root, 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs');
        const manifest = path.join(root, 'node_modules', 'typescript', 'package.json');
        const tsserver = path.join(root, 'node_modules', 'typescript', 'lib', 'tsserver.js');
        const present = new Set([cli, manifest, tsserver]);
        return {
            exists: (candidate) => present.has(candidate),
            readJson: (file) => (file === manifest ? { version: '5.9.2' } : undefined),
            resolveBundled: () => undefined,
            nodePath,
        };
    }

    it('hands the session the resolved TypeScript runtime instead of the bare command', () => {
        const workspaceRoot = tempDir('coc-lsp-ts-repo-');
        const harness = createHarness([{ ...TYPESCRIPT_PRESET, enabled: true }], {
            prepareDeps: typescriptDeps(workspaceRoot),
        });
        const result = harness.manager.acquire({
            workspaceId: 'ws-a',
            workspaceRoot,
            editingSessionId: 'browser-1',
            relativePath: 'src/index.ts',
        });

        expect(result.ok).toBe(true);
        const sessionOptions = harness.created[0];
        expect(sessionOptions.definition.command).toBe(nodePath);
        expect(sessionOptions.definition.args[0]).toContain('typescript-language-server');
        expect(sessionOptions.definition.initializationOptions).toEqual({
            tsserver: { path: path.join(path.resolve(workspaceRoot), 'node_modules', 'typescript', 'lib', 'tsserver.js') },
        });
        expect(sessionOptions.runtimeLabel).toBe('Server: workspace \u00b7 TypeScript 5.9.2: workspace');
        expect(sessionOptions.commandLabel).toBe('typescript-language-server');
        // The state a browser may see names the toolchain, never a host path.
        const state = harness.manager.listStates()[0];
        expect(state.runtime).toBe('Server: workspace \u00b7 TypeScript 5.9.2: workspace');
        expect(JSON.stringify(state)).not.toContain('node_modules');
    });

    it('forwards Rust install guidance without exposing a host path', () => {
        const harness = createHarness([{ ...RUST_PRESET, enabled: true }], {
            prepareDeps: {
                runRustupWhich: () => undefined,
                resolveOnPath: () => undefined,
            },
        });
        const result = harness.manager.acquire({
            workspaceId: 'ws-a',
            workspaceRoot: harness.workspaceRoot,
            editingSessionId: 'browser-1',
            relativePath: 'src/lib.rs',
        });

        expect(result.ok).toBe(true);
        expect(harness.created[0]).toMatchObject({
            commandLabel: 'rust-analyzer',
            runtimeLabel: 'Server: unavailable',
            unavailableDetail: 'Install with: rustup component add rust-analyzer',
        });
        expect(JSON.stringify(harness.manager.listStates())).not.toContain(harness.workspaceRoot);
    });

    it('leaves a non-TypeScript definition exactly as configured', () => {
        const harness = createHarness();
        acquireTxt(harness, 'browser-1');

        const sessionOptions = harness.created[0];
        expect(sessionOptions.definition.command).toBe(process.execPath);
        expect(sessionOptions.definition.args).toEqual([FIXTURE_SERVER]);
        expect(sessionOptions.runtimeLabel).toBeUndefined();
        expect(sessionOptions.commandLabel).toBeUndefined();
        expect(sessionOptions.unavailableDetail).toBeUndefined();
    });
});
