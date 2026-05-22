/**
 * Queue Executor Bridge — Follow-Up Skill Resolution Tests
 *
 * Verifies that `executeFollowUp` resolves `skillDirectories` and
 * `disabledSkills` and passes them to `sendMessage`, mirroring the behaviour
 * already present in `executeWithAI`.
 */

import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Partial mock of fs — controls existsSync so skill-dir probing is testable
// ---------------------------------------------------------------------------

    vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
        promises: {
            ...actual.promises,
            access: vi.fn(actual.promises.access),
            readFile: vi.fn(actual.promises.readFile),
            mkdir: vi.fn().mockResolvedValue(undefined),
            readdir: vi.fn().mockResolvedValue([]),
        },
    };
});

import * as fs from 'fs';

import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

// ---------------------------------------------------------------------------
// Mock SDK
// ---------------------------------------------------------------------------

const sdkMocks = createMockSDKService();

function normalizeLinuxPathForTest(input: string): string {
    const normalized = input.replace(/\\/g, '/').replace(/\/+$/g, '');
    return normalized.length > 0 ? normalized : '/';
}

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    const ensureBareLinuxContext = (workingDirectory?: string) => {
        const ctx = actual.resolveWorkspaceExecutionContext(workingDirectory);
        if (process.platform === 'win32' && workingDirectory?.startsWith('/') && ctx.kind === 'wsl' && !ctx.distro) {
            return { ...ctx, distro: 'Ubuntu' };
        }
        return ctx;
    };

    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
        resolveWorkspaceExecutionContext: ensureBareLinuxContext,
        normalizeExecutionPath: (pathLike: string) => {
            const ctx = ensureBareLinuxContext(pathLike);
            if (ctx.kind === 'wsl') {
                return actual.normalizeWslExecutionPath(ctx.linuxWorkingDirectory, ctx.distro);
            }
            return actual.normalizeExecutionPath(pathLike);
        },
        resolvePathForHostFilesystem: (basePath: string, ...segments: string[]) => {
            if (process.platform === 'win32' && basePath.startsWith('/')) {
                const linuxPath = segments.length > 0
                    ? normalizeLinuxPathForTest([basePath, ...segments.map(segment => segment.replace(/\\/g, '/').replace(/^\/+/, ''))].join('/'))
                    : normalizeLinuxPathForTest(basePath);
                return path.win32.normalize(`\\\\wsl$\\Ubuntu${linuxPath === '/' ? '' : linuxPath.replace(/\//g, '\\')}`);
            }
            return actual.resolvePathForHostFilesystem(basePath, ...segments);
        },
    };
});

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('@plusplusoneplusplus/coc-server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-server')>();
    return {
        ...actual,
        ImageBlobStore: {
            loadImages: vi.fn().mockResolvedValue([]),
            saveImages: vi.fn(),
            deleteImages: vi.fn(),
            getBlobsDir: vi.fn(),
        },
    };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFollowUpTask(processId: string, content = 'follow up'): QueuedTask {
    return {
        id: 'fu-skills-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat', processId, prompt: content },
        config: {},
        displayName: content,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeFollowUp — skill configuration', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let CLITaskExecutor: typeof import('../../src/server/queue/queue-executor-bridge').CLITaskExecutor;

    beforeEach(async () => {
        vi.resetModules();
        ({ CLITaskExecutor } = await import('../../src/server/queue/queue-executor-bridge'));
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        // Default: no skill directories exist
        (fs.promises.access as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    });

    // 1 -----------------------------------------------------------------------
    it('should pass skillDirectories to sendMessage when global skills dir exists', async () => {
        const dataDir = path.join(os.homedir(), '.coc');
        const globalSkillsDir = path.join(dataDir, 'skills');

        (fs.promises.access as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) =>
            p === globalSkillsDir ? Promise.resolve() : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service, dataDir });
        const proc = createCompletedProcessWithSession('proc-s1', 'sess-1');
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s1', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.skillDirectories).toEqual([globalSkillsDir]);
    });

    // 2 -----------------------------------------------------------------------
    it('should include repo-local skills dir when it exists', async () => {
        const workDir = process.platform === 'win32'
            ? String.raw`C:\tmp\my-project`
            : '/tmp/my-project';
        const localSkillsDir = path.join(workDir, '.github', 'skills');

        (fs.promises.access as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) =>
            p === localSkillsDir ? Promise.resolve() : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-s2', 'sess-2');
        proc.workingDirectory = workDir;
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s2', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.skillDirectories).toContain(localSkillsDir);
    });

    // 3 -----------------------------------------------------------------------
    it('should pass disabledSkills from workspace config to sendMessage', async () => {
        const wsId = 'ws-abc123';
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: wsId, disabledSkills: ['skill-a', 'skill-b'] },
        ]);

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-s3', 'sess-3');
        proc.metadata = { ...(proc.metadata ?? {}), workspaceId: wsId };
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s3', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.disabledSkills).toEqual(['skill-a', 'skill-b']);
    });

    // 4 -----------------------------------------------------------------------
    it('should pass disabledSkills from global preferences to sendMessage', async () => {
        const dataDir = path.join(os.tmpdir(), 'coc-test-prefs');
        const prefsPath = path.join(dataDir, 'preferences.json');
        const prefs = JSON.stringify({ globalDisabledSkills: ['global-skill-x'] });

        (fs.promises.access as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) =>
            p === prefsPath ? Promise.resolve() : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        );
        (fs.promises.readFile as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) => {
            if (p === prefsPath) return Promise.resolve(prefs);
            return Promise.reject(new Error('not found'));
        });

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service, dataDir });
        const proc = createCompletedProcessWithSession('proc-s4', 'sess-4');
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s4', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.disabledSkills).toContain('global-skill-x');
    });

    // 5 -----------------------------------------------------------------------
    it('should pass undefined skillDirectories when no skill dirs exist', async () => {
        // existsSync always returns false (set in beforeEach)
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-s5', 'sess-5');
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s5', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.skillDirectories).toBeUndefined();
    });

    // 6 -----------------------------------------------------------------------
    it('should pass undefined disabledSkills when no workspace or prefs configure any', async () => {
        // existsSync returns false (set in beforeEach), store.getWorkspaces returns []
        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-s6', 'sess-6');
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s6', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.disabledSkills).toBeUndefined();
    });

    // 7 -----------------------------------------------------------------------
    it('should order repo-local before global skills dir', async () => {
        const dataDir = path.join(os.homedir(), '.coc');
        const globalSkillsDir = path.join(dataDir, 'skills');
        const workDir = process.platform === 'win32'
            ? String.raw`C:\tmp\my-project`
            : '/tmp/my-project';
        const localSkillsDir = path.join(workDir, '.github', 'skills');

        (fs.promises.access as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) =>
            (p === globalSkillsDir || p === localSkillsDir) ? Promise.resolve() : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service, dataDir });
        const proc = createCompletedProcessWithSession('proc-s7', 'sess-7');
        proc.workingDirectory = workDir;
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s7', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        // repo-local should come first
        expect(callOpts.skillDirectories[0]).toBe(localSkillsDir);
        expect(callOpts.skillDirectories[1]).toBe(globalSkillsDir);
    });

    // 8 -----------------------------------------------------------------------
    it('should include extraSkillFolders (absolute) after global skills dir', async () => {
        const extraDir = process.platform === 'win32'
            ? String.raw`C:\abs\path\to\team-skills`
            : '/abs/path/to/team-skills';
        const wsId = 'ws-extra-abs';
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: wsId, extraSkillFolders: [extraDir] },
        ]);
        (fs.promises.access as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) =>
            p === extraDir ? Promise.resolve() : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-s8', 'sess-8');
        proc.metadata = { ...(proc.metadata ?? {}), workspaceId: wsId };
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s8', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.skillDirectories).toContain(extraDir);
    });

    // 9 -----------------------------------------------------------------------
    it('should resolve relative extraSkillFolders against workingDirectory', async () => {
        const workDir = process.platform === 'win32'
            ? String.raw`C:\tmp\my-project`
            : '/tmp/my-project';
        const relativeFolder = './custom-skills';
        const resolvedDir = path.resolve(workDir, relativeFolder);
        const wsId = 'ws-extra-rel';
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: wsId, extraSkillFolders: [relativeFolder] },
        ]);
        (fs.promises.access as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) =>
            p === resolvedDir ? Promise.resolve() : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-s9', 'sess-9');
        proc.workingDirectory = workDir;
        proc.metadata = { ...(proc.metadata ?? {}), workspaceId: wsId };
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s9', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.skillDirectories).toContain(resolvedDir);
    });

    // 10 ----------------------------------------------------------------------
    it('should skip extraSkillFolders that do not exist', async () => {
        const wsId = 'ws-extra-missing';
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: wsId, extraSkillFolders: [process.platform === 'win32' ? String.raw`C:\does\not\exist` : '/does/not/exist'] },
        ]);
        // existsSync always returns false (set in beforeEach)

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-s10', 'sess-10');
        proc.metadata = { ...(proc.metadata ?? {}), workspaceId: wsId };
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s10', 'follow up');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.skillDirectories).toBeUndefined();
    });

    // 11 ----------------------------------------------------------------------
    it.runIf(process.platform === 'win32')('translates WSL UNC repo-local skills to Linux paths for the SDK', async () => {
        const workDir = String.raw`\\wsl$\Ubuntu\home\tester\repo`;
        const hostSkillsDir = String.raw`\\wsl$\Ubuntu\home\tester\repo\.github\skills`;

        (fs.promises.access as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) =>
            p === hostSkillsDir ? Promise.resolve() : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-s11', 'sess-11');
        proc.workingDirectory = workDir;
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s11', 'follow up');

        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.skillDirectories).toContain('/home/tester/repo/.github/skills');
    });

    // 12 ----------------------------------------------------------------------
    it('translates global Windows skill directories for WSL-backed sessions', async () => {
        const dataDir = String.raw`C:\Users\tester\.coc`;
        const globalSkillsDir = path.join(dataDir, 'skills');
        const workDir = String.raw`\\wsl$\Ubuntu\home\tester\repo`;

        (fs.promises.access as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) =>
            p === globalSkillsDir ? Promise.resolve() : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service, dataDir });
        const proc = createCompletedProcessWithSession('proc-s12', 'sess-12');
        proc.workingDirectory = workDir;
        await store.addProcess(proc);

        await executor.executeFollowUp('proc-s12', 'follow up');

        const callOpts = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(callOpts.skillDirectories).toContain('/mnt/c/Users/tester/.coc/skills');
    });

    // 13 ----------------------------------------------------------------------
    it.runIf(process.platform === 'win32')('resolves bare Linux working directories for host probing once workspace is identified', async () => {
        const workDir = '/home/tester/repo';
        const hostSkillsDir = String.raw`\\wsl$\Ubuntu\home\tester\repo\.github\skills`;
        const wsId = 'ws-linux-root';

        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            { id: wsId, rootPath: String.raw`\\wsl$\Ubuntu\home\tester\repo`, disabledSkills: ['impl'] },
        ]);
        (fs.promises.access as ReturnType<typeof vi.fn>).mockImplementation((p: unknown) =>
            p === hostSkillsDir ? Promise.resolve() : Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        );

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service });
        const proc = createCompletedProcessWithSession('proc-s13', 'sess-13');
        proc.workingDirectory = workDir;
        proc.metadata = { ...(proc.metadata ?? {}), workspaceId: wsId };
        await store.addProcess(proc);

        const { resolveSkillConfig } = await import('../../src/server/executors/skill-config-resolver');
        const skillConfig = await resolveSkillConfig(store, undefined, wsId, workDir);
        expect(skillConfig.skillDirectories).toContain('/home/tester/repo/.github/skills');
        expect(skillConfig.disabledSkills).toEqual(['impl']);
    });
});
