/**
 * Queue Executor Bridge — Runtime Config Port Integration Tests
 *
 * `CLITaskExecutor` used to call no-argument `loadConfigFile()` on every task
 * execution to resolve global skill folders, and again to read the Ralph
 * final-check loop cap. Both always resolved `~/.coc/config.yaml`, so a server
 * started with an explicit `--config` path executed tasks against a different
 * file than its admin and diagnostics surfaces showed.
 *
 * These tests pin the replacement: the bridge reads skill folders through the
 * injected `QueueRuntimeConfig` port, honours live edits to it, and leaves
 * repo-scoped skill preferences untouched.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { RuntimeConfigService } from '../../src/config/runtime-config-service';
import {
    createQueueRuntimeConfig,
    createFixedQueueRuntimeConfig,
} from '../../src/server/queue/queue-runtime-config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDirs: string[] = [];

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tmpDirs.push(dir);
    return dir;
}

/**
 * A real on-disk skill folder. `resolveSkillConfig` probes the filesystem, so
 * a folder only reaches `skillDirectories` if it actually exists.
 */
function makeSkillFolder(name: string): string {
    const dir = makeTempDir(name);
    fs.mkdirSync(path.join(dir, 'a-skill'), { recursive: true });
    return dir;
}

/** Run one follow-up turn and return the `skillDirectories` the SDK received. */
async function resolvedSkillDirectories(executor: CLITaskExecutor, processId: string): Promise<string[]> {
    await executor.executeFollowUp(processId, 'follow up');
    const callOpts = sdkMocks.mockSendMessage.mock.calls.at(-1)![0] as any;
    return (callOpts.skillDirectories ?? []) as string[];
}

describe('CLITaskExecutor — QueueRuntimeConfig integration', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let dataDir: string;

    beforeEach(async () => {
        vi.clearAllMocks();
        sdkMocks.reset?.();
        dataDir = makeTempDir('bridge-runtime-config-data-');
        store = createMockProcessStore();
    });

    afterEach(() => {
        for (const dir of tmpDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        tmpDirs = [];
    });

    // -- Authoritative source ------------------------------------------------

    it('resolves global skill folders from the injected port, not the default config file', async () => {
        const portFolder = makeSkillFolder('port-skills-');

        const executor = new CLITaskExecutor(store, {
            aiService: sdkMocks.service,
            dataDir,
            queueConfig: createFixedQueueRuntimeConfig({
                skillFolders: { globalExtraFolders: [portFolder], autoDetectDefaultFolders: false },
            }),
        });
        await store.addProcess(createCompletedProcessWithSession('proc-port', 'sess-port'));

        expect(await resolvedSkillDirectories(executor, 'proc-port')).toContain(portFolder);
    });

    it('uses an explicit config path over a conflicting default-path config', async () => {
        const explicitFolder = makeSkillFolder('explicit-skills-');
        const defaultFolder = makeSkillFolder('default-skills-');

        // The config the server was actually started with.
        const configDir = makeTempDir('explicit-config-');
        const configPath = path.join(configDir, 'config.yaml');
        fs.writeFileSync(
            configPath,
            `skills:\n  globalExtraFolders:\n    - ${JSON.stringify(explicitFolder)}\n  autoDetectDefaultFolders: false\n`,
            'utf8',
        );

        // A conflicting config sitting at the default home-directory location.
        // The old `loadConfigFile()` path would have picked this one up.
        const fakeHome = makeTempDir('fake-home-');
        fs.mkdirSync(path.join(fakeHome, '.coc'), { recursive: true });
        fs.writeFileSync(
            path.join(fakeHome, '.coc', 'config.yaml'),
            `skills:\n  globalExtraFolders:\n    - ${JSON.stringify(defaultFolder)}\n  autoDetectDefaultFolders: false\n`,
            'utf8',
        );
        // `os.homedir()` is not spyable through an ESM namespace, so redirect
        // it the way Node itself resolves it: $HOME on POSIX, %USERPROFILE% on
        // Windows.
        const prevHome = process.env.HOME;
        const prevUserProfile = process.env.USERPROFILE;
        process.env.HOME = fakeHome;
        process.env.USERPROFILE = fakeHome;

        try {
            const executor = new CLITaskExecutor(store, {
                aiService: sdkMocks.service,
                dataDir,
                queueConfig: createQueueRuntimeConfig(new RuntimeConfigService({ configPath })),
            });
            await store.addProcess(createCompletedProcessWithSession('proc-explicit', 'sess-explicit'));

            const dirs = await resolvedSkillDirectories(executor, 'proc-explicit');
            expect(dirs).toContain(explicitFolder);
            expect(dirs).not.toContain(defaultFolder);
        } finally {
            if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
            if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
        }
    });

    // -- Live updates --------------------------------------------------------

    it('picks up a live skill-folder change without rebuilding the executor', async () => {
        const firstFolder = makeSkillFolder('first-skills-');
        const secondFolder = makeSkillFolder('second-skills-');

        const configDir = makeTempDir('live-config-');
        const configPath = path.join(configDir, 'config.yaml');
        const writeFolders = (folder: string) => fs.writeFileSync(
            configPath,
            `skills:\n  globalExtraFolders:\n    - ${JSON.stringify(folder)}\n  autoDetectDefaultFolders: false\n`,
            'utf8',
        );

        writeFolders(firstFolder);
        const service = new RuntimeConfigService({ configPath });

        const executor = new CLITaskExecutor(store, {
            aiService: sdkMocks.service,
            dataDir,
            queueConfig: createQueueRuntimeConfig(service),
        });
        await store.addProcess(createCompletedProcessWithSession('proc-live', 'sess-live'));

        expect(await resolvedSkillDirectories(executor, 'proc-live')).toContain(firstFolder);

        writeFolders(secondFolder);
        service.refresh();

        // Same executor instance — the next task sees the new folder.
        const dirs = await resolvedSkillDirectories(executor, 'proc-live');
        expect(dirs).toContain(secondFolder);
        expect(dirs).not.toContain(firstFolder);
    });

    it('does not read a config file on the execution path', async () => {
        const configModule = await import('../../src/config');
        const loadSpy = vi.spyOn(configModule, 'loadConfigFile');

        const executor = new CLITaskExecutor(store, {
            aiService: sdkMocks.service,
            dataDir,
            queueConfig: createFixedQueueRuntimeConfig({
                skillFolders: { autoDetectDefaultFolders: false },
            }),
        });
        await store.addProcess(createCompletedProcessWithSession('proc-noio', 'sess-noio'));

        await executor.executeFollowUp('proc-noio', 'follow up');

        // The old hot path reparsed YAML on every task.
        expect(loadSpy).not.toHaveBeenCalled();
        loadSpy.mockRestore();
    });

    // -- Repo scoping --------------------------------------------------------

    it('keeps repo-scoped skill preferences separate from the global port', async () => {
        const globalFolder = makeSkillFolder('global-skills-');
        const workspaceId = 'ws-scoped';

        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: workspaceId, disabledSkills: ['repo-only-skill'] },
        ]);

        const executor = new CLITaskExecutor(store, {
            aiService: sdkMocks.service,
            dataDir,
            queueConfig: createFixedQueueRuntimeConfig({
                skillFolders: { globalExtraFolders: [globalFolder], autoDetectDefaultFolders: false },
            }),
        });

        const proc = createCompletedProcessWithSession('proc-scoped', 'sess-scoped');
        proc.metadata = { ...(proc.metadata ?? {}), workspaceId };
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-scoped', 'follow up');
        const callOpts = sdkMocks.mockSendMessage.mock.calls.at(-1)![0] as any;

        // Global value arrives via the shared port…
        expect(callOpts.skillDirectories).toContain(globalFolder);
        // …while the repo's own preference stays repo-scoped.
        expect(callOpts.disabledSkills).toEqual(['repo-only-skill']);
    });
});
