import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChatMode } from '../../src/server/tasks/task-types';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import {
    ENDEV_XDPU_MCP_SERVER_NAME,
    setEnDevXDpuHostPlatformForTesting,
    setEnDevXDpuWslCommandRunnerForTesting,
} from '../../src/server/endev/endev-xdpu';
import type { EnDevXDpuWslCommandRunner } from '../../src/server/endev/endev-xdpu';
import { createCompletedProcessWithSession, createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import type { QueuedTask, WorkspaceInfo } from '@plusplusoneplusplus/forge';

const WSL_ROOT = String.raw`\\wsl$\Ubuntu\home\user\xstore`;
const NATIVE_WSL_ROOT = '/home/user/xstore';

function createMcpRunner(): EnDevXDpuWslCommandRunner {
    return vi.fn(async () => ({
        exitCode: 0,
        stdout: [
            'MCP=/home/user/.endev/generated/.mcp.json',
            'JSON_BEGIN',
            JSON.stringify({
                mcpServers: {
                    [ENDEV_XDPU_MCP_SERVER_NAME]: {
                        command: 'funbird-mcp',
                        args: ['serve'],
                    },
                },
            }),
            'JSON_END',
        ].join('\n'),
        stderr: '',
    }));
}

function expectBridgedFunbirdMcp(sendOptions: any): void {
    expect(sendOptions.mcpServers).toEqual({
        [ENDEV_XDPU_MCP_SERVER_NAME]: expect.objectContaining({
            type: 'stdio',
            command: path.win32.join(process.env.SystemRoot!, 'System32', 'wsl.exe'),
            args: ['-d', 'Ubuntu', '--cd', '/home/user/xstore', '--', 'funbird-mcp', 'serve'],
        }),
    });
    expect(sendOptions.loadDefaultMcpConfig).toBe(false);
}

function expectNativeFunbirdMcp(sendOptions: any): void {
    expect(sendOptions.mcpServers).toEqual({
        [ENDEV_XDPU_MCP_SERVER_NAME]: expect.objectContaining({
            type: 'stdio',
            command: 'funbird-mcp',
            args: ['serve'],
            cwd: NATIVE_WSL_ROOT,
            tools: ['*'],
        }),
    });
    expect(sendOptions.loadDefaultMcpConfig).toBe(false);
}

describe('EnDev-xDpu MCP bridge in chat executors', () => {
    let dataDir: string;
    let originalSystemRoot: string | undefined;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'endev-mcp-executor-'));
        originalSystemRoot = process.env.SystemRoot;
        process.env.SystemRoot = originalSystemRoot ?? String.raw`C:\Windows`;
        setEnDevXDpuHostPlatformForTesting('win32');
        setEnDevXDpuWslCommandRunnerForTesting(undefined);
    });

    afterEach(() => {
        setEnDevXDpuHostPlatformForTesting(undefined);
        setEnDevXDpuWslCommandRunnerForTesting(undefined);
        if (originalSystemRoot === undefined) {
            delete process.env.SystemRoot;
        } else {
            process.env.SystemRoot = originalSystemRoot;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it.each(['ask', 'plan', 'autopilot'] as const)(
        'passes bridged funbird-mcp to %s dashboard sessions for enabled WSL workspaces',
        async (mode: ChatMode) => {
            const sdkMocks = createMockSDKService();
            const store = createMockProcessStore();
            const workspace: WorkspaceInfo = {
                id: 'ws-endev',
                name: 'xStore',
                rootPath: WSL_ROOT,
                endevXDpu: {
                    enabled: true,
                    wslDistro: 'Ubuntu',
                    xstoreRepoRoot: '/home/user/xstore',
                    mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
                },
            };
            (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([workspace]);
            setEnDevXDpuWslCommandRunnerForTesting(createMcpRunner());

            const executor = new CLITaskExecutor(store, {
                aiService: sdkMocks.service as any,
                dataDir,
            });
            const task: QueuedTask = {
                id: `endev-${mode}`,
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode,
                    prompt: 'Use EnDev',
                    workspaceId: workspace.id,
                    workingDirectory: workspace.rootPath,
                },
                config: {},
            };

            await executor.execute(task);

            expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
            expectBridgedFunbirdMcp(sdkMocks.mockSendMessage.mock.calls[0][0]);
        },
    );

    it('passes native funbird-mcp config to dashboard sessions when CoC runs inside WSL', async () => {
        setEnDevXDpuHostPlatformForTesting('linux');
        const sdkMocks = createMockSDKService();
        const store = createMockProcessStore();
        const workspace: WorkspaceInfo = {
            id: 'ws-native-endev',
            name: 'xStore native WSL',
            rootPath: NATIVE_WSL_ROOT,
            endevXDpu: {
                enabled: true,
                xstoreRepoRoot: NATIVE_WSL_ROOT,
                mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
            },
        };
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([workspace]);
        setEnDevXDpuWslCommandRunnerForTesting(createMcpRunner());

        const executor = new CLITaskExecutor(store, {
            aiService: sdkMocks.service as any,
            dataDir,
        });
        const task: QueuedTask = {
            id: 'endev-native',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat' as const,
                mode: 'ask',
                prompt: 'Use native EnDev',
                workspaceId: workspace.id,
                workingDirectory: workspace.rootPath,
            },
            config: {},
        };

        await executor.execute(task);

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        expectNativeFunbirdMcp(sdkMocks.mockSendMessage.mock.calls[0][0]);
    });

    it('passes bridged funbird-mcp to follow-up sessions for enabled WSL workspaces', async () => {
        const sdkMocks = createMockSDKService();
        const store = createMockProcessStore();
        const workspace: WorkspaceInfo = {
            id: 'ws-endev-follow-up',
            name: 'xStore',
            rootPath: WSL_ROOT,
            endevXDpu: {
                enabled: true,
                wslDistro: 'Ubuntu',
                xstoreRepoRoot: '/home/user/xstore',
                mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
            },
        };
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([workspace]);
        setEnDevXDpuWslCommandRunnerForTesting(createMcpRunner());

        const process = createCompletedProcessWithSession('proc-endev-follow-up', 'session-endev');
        process.workingDirectory = workspace.rootPath;
        process.metadata = { type: 'chat', workspaceId: workspace.id, mode: 'ask' };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store, {
            aiService: sdkMocks.service as any,
            dataDir,
        });

        await executor.executeFollowUp(process.id, 'Continue with EnDev');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
        expectBridgedFunbirdMcp(sdkMocks.mockSendMessage.mock.calls[0][0]);
    });

    it('does not add MCP overrides for workspaces where EnDev-xDpu is disabled', async () => {
        const sdkMocks = createMockSDKService();
        const store = createMockProcessStore();
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                id: 'ws-disabled',
                name: 'xStore',
                rootPath: WSL_ROOT,
                endevXDpu: { enabled: false },
            },
        ] satisfies WorkspaceInfo[]);
        const runner = createMcpRunner();
        setEnDevXDpuWslCommandRunnerForTesting(runner);

        const executor = new CLITaskExecutor(store, {
            aiService: sdkMocks.service as any,
            dataDir,
        });
        const task: QueuedTask = {
            id: 'endev-disabled',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat' as const,
                mode: 'ask',
                prompt: 'Do not use EnDev',
                workspaceId: 'ws-disabled',
                workingDirectory: WSL_ROOT,
            },
            config: {},
        };

        await executor.execute(task);

        expect(runner).not.toHaveBeenCalled();
        expect(sdkMocks.mockSendMessage.mock.calls[0][0].mcpServers).toBeUndefined();
        expect(sdkMocks.mockSendMessage.mock.calls[0][0].loadDefaultMcpConfig).toBeUndefined();
    });
});
