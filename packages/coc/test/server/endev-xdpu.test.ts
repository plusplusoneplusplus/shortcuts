import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import {
    activateEnDevXDpuWorkspace,
    ENDEV_XDPU_HBM_SMOKE_SAMPLE,
    ENDEV_XDPU_HBM_SMOKE_SANITY_JOB_ID,
    ENDEV_XDPU_MCP_SERVER_NAME,
    ENDEV_XDPU_WRAPPER_SKILL_NAME,
    EnDevXDpuSetupError,
    resolveEnDevXDpuMcpServers,
    setEnDevXDpuHostPlatformForTesting,
    setEnDevXDpuWslCommandRunnerForTesting,
} from '../../src/server/endev/endev-xdpu';
import type { EnDevXDpuWslCommandRunner } from '../../src/server/endev/endev-xdpu';

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body,
                        json: () => JSON.parse(body),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function createSuccessfulRunner(): EnDevXDpuWslCommandRunner {
    return vi.fn(async (req) => {
        if (req.command === 'endev doctor') {
            return { exitCode: 0, stdout: 'endev doctor ok\n', stderr: '' };
        }
        expect(req.command).toContain('dpu-log-triage');
        return {
            exitCode: 0,
            stdout: [
                'SKILLS=/home/user/xstore/Developer/private/EnDpuDev/plugin/skills',
                'MCP=/home/user/.endev/generated/.mcp.json',
                '',
            ].join('\n'),
            stderr: '',
        };
    });
}

describe('EnDev-xDpu activation', () => {
    let dataDir: string;
    let originalSystemRoot: string | undefined;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'endev-xdpu-test-'));
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

    it('runs endev doctor, installs the wrapper skill, and adds discovered plugin skills to extraSkillFolders', async () => {
        const store = new FileProcessStore({ dataDir });
        const workspace: WorkspaceInfo = {
            id: 'ws-endev',
            name: 'xStore WSL',
            rootPath: String.raw`\\wsl$\Ubuntu\home\user\xstore`,
            endevXDpu: { enabled: true },
        };
        await store.registerWorkspace(workspace);
        const runner = createSuccessfulRunner();

        const result = await activateEnDevXDpuWorkspace(store, workspace, dataDir, runner);

        expect(runner).toHaveBeenCalledTimes(2);
        expect(runner).toHaveBeenNthCalledWith(1, expect.objectContaining({
            distro: 'Ubuntu',
            linuxWorkingDirectory: '/home/user/xstore',
            command: 'endev doctor',
        }));
        expect(result.pluginSkillFolder).toBe('/home/user/xstore/Developer/private/EnDpuDev/plugin/skills');
        expect(result.mcpConfigPath).toBe('/home/user/.endev/generated/.mcp.json');
        expect(result.extraSkillFolder).toBe(String.raw`\\wsl$\Ubuntu\home\user\xstore\Developer\private\EnDpuDev\plugin\skills`);
        expect(result.workspace.extraSkillFolders).toEqual([result.extraSkillFolder]);

        const persisted = (await store.getWorkspaces()).find(ws => ws.id === workspace.id);
        expect(persisted?.extraSkillFolders).toEqual([result.extraSkillFolder]);
        expect(persisted?.endevXDpu).toEqual({
            enabled: true,
            wslDistro: 'Ubuntu',
            xstoreRepoRoot: '/home/user/xstore',
            mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
        });

        const wrapperPath = path.join(dataDir, 'skills', ENDEV_XDPU_WRAPPER_SKILL_NAME, 'SKILL.md');
        expect(result.wrapperSkillPath).toBe(wrapperPath);
        const wrapper = fs.readFileSync(wrapperPath, 'utf-8');
        expect(wrapper).toContain(`name: ${ENDEV_XDPU_WRAPPER_SKILL_NAME}`);
        expect(wrapper).toContain('## Manual HBM smoke validation');
        expect(wrapper).toContain(`sanity job ${ENDEV_XDPU_HBM_SMOKE_SANITY_JOB_ID}`);
        expect(wrapper).toContain(ENDEV_XDPU_HBM_SMOKE_SAMPLE);
        expect(wrapper).toContain('Do not run this path in CI, unit tests, or automated workflow validation.');
    });

    it('runs EnDev discovery directly and stores Linux skill paths when CoC runs natively in WSL', async () => {
        setEnDevXDpuHostPlatformForTesting('linux');
        const store = new FileProcessStore({ dataDir });
        const workspace: WorkspaceInfo = {
            id: 'ws-native-endev',
            name: 'xStore native WSL',
            rootPath: '/home/user/xstore',
            endevXDpu: { enabled: true },
        };
        await store.registerWorkspace(workspace);
        const runner = createSuccessfulRunner();

        const result = await activateEnDevXDpuWorkspace(store, workspace, dataDir, runner);

        expect(runner).toHaveBeenCalledTimes(2);
        expect(runner).toHaveBeenNthCalledWith(1, expect.objectContaining({
            distro: undefined,
            linuxWorkingDirectory: '/home/user/xstore',
            command: 'endev doctor',
        }));
        expect(result.wslDistro).toBeUndefined();
        expect(result).toEqual(expect.objectContaining({
            xstoreRepoRoot: '/home/user/xstore',
            pluginSkillFolder: '/home/user/xstore/Developer/private/EnDpuDev/plugin/skills',
            extraSkillFolder: '/home/user/xstore/Developer/private/EnDpuDev/plugin/skills',
            mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
        }));

        const persisted = (await store.getWorkspaces()).find(ws => ws.id === workspace.id);
        expect(persisted?.extraSkillFolders).toEqual([
            '/home/user/xstore/Developer/private/EnDpuDev/plugin/skills',
        ]);
        expect(persisted?.endevXDpu).toEqual({
            enabled: true,
            xstoreRepoRoot: '/home/user/xstore',
            mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
        });
    });

    it('searches EnDev source plugin skill and MCP layouts during activation', async () => {
        const store = new FileProcessStore({ dataDir });
        const workspace: WorkspaceInfo = {
            id: 'ws-endev-source-layout',
            name: 'xStore WSL',
            rootPath: String.raw`\\wsl$\Ubuntu\home\user\xstore`,
            endevXDpu: { enabled: true },
        };
        await store.registerWorkspace(workspace);
        const runner = vi.fn<EnDevXDpuWslCommandRunner>(async (req) => {
            if (req.command === 'endev doctor') {
                return { exitCode: 0, stdout: 'endev doctor ok\n', stderr: '' };
            }
            expect(req.command).toContain('"\\$HOME/.endev/source"');
            expect(req.command).toContain('"\\$root/Developer/private/EnDpuDev/plugin/skills"');
            expect(req.command).toContain('for skill in \\$required; do');
            expect(req.command).toContain("'*/dpu-log-triage/SKILL.md'");
            expect(req.command).toContain("-name '.mcp.json'");
            expect(req.command).toContain("'*/.vscode/mcp.json'");
            return {
                exitCode: 0,
                stdout: [
                    'SKILLS=/home/user/.endev/source/worktrees/xstore/Developer/private/EnDpuDev/plugin/skills',
                    'MCP=/home/user/.endev/source/worktrees/xstore/.mcp.json',
                    '',
                ].join('\n'),
                stderr: '',
            };
        });

        const result = await activateEnDevXDpuWorkspace(store, workspace, dataDir, runner);

        expect(result.pluginSkillFolder).toBe('/home/user/.endev/source/worktrees/xstore/Developer/private/EnDpuDev/plugin/skills');
        expect(result.mcpConfigPath).toBe('/home/user/.endev/source/worktrees/xstore/.mcp.json');
        expect(result.extraSkillFolder).toBe(String.raw`\\wsl$\Ubuntu\home\user\.endev\source\worktrees\xstore\Developer\private\EnDpuDev\plugin\skills`);
    });

    it('does not duplicate an existing discovered plugin skill folder', async () => {
        const store = new FileProcessStore({ dataDir });
        const extraSkillFolder = String.raw`\\wsl$\Ubuntu\home\user\xstore\Developer\private\EnDpuDev\plugin\skills`;
        const workspace: WorkspaceInfo = {
            id: 'ws-endev-existing',
            name: 'xStore WSL',
            rootPath: String.raw`\\wsl$\Ubuntu\home\user\xstore`,
            extraSkillFolders: [extraSkillFolder],
            endevXDpu: { enabled: true, wslDistro: 'Ubuntu', xstoreRepoRoot: '/home/user/xstore' },
        };
        await store.registerWorkspace(workspace);

        const result = await activateEnDevXDpuWorkspace(store, workspace, dataDir, createSuccessfulRunner());

        expect(result.workspace.extraSkillFolders).toEqual([extraSkillFolder]);
    });

    it('requires EnDev generated MCP config during discovery', async () => {
        const store = new FileProcessStore({ dataDir });
        const workspace: WorkspaceInfo = {
            id: 'ws-endev-no-mcp',
            name: 'xStore WSL',
            rootPath: String.raw`\\wsl$\Ubuntu\home\user\xstore`,
            endevXDpu: { enabled: true },
        };
        const runner = vi.fn<EnDevXDpuWslCommandRunner>(async (req) => {
            if (req.command === 'endev doctor') {
                return { exitCode: 0, stdout: 'ok', stderr: '' };
            }
            return {
                exitCode: 0,
                stdout: 'SKILLS=/home/user/xstore/Developer/private/EnDpuDev/plugin/skills\n',
                stderr: '',
            };
        });

        await expect(activateEnDevXDpuWorkspace(store, workspace, dataDir, runner))
            .rejects.toMatchObject({
                code: 'ENDEV_XDPU_MCP_CONFIG_NOT_FOUND',
            } satisfies Partial<EnDevXDpuSetupError>);
    });

    it('bridges EnDev funbird-mcp through wsl.exe without modifying global Copilot config', async () => {
        const workspace: WorkspaceInfo = {
            id: 'ws-endev-mcp',
            name: 'xStore WSL',
            rootPath: String.raw`\\wsl$\Ubuntu\home\user\xstore`,
            endevXDpu: {
                enabled: true,
                wslDistro: 'Ubuntu',
                xstoreRepoRoot: '/home/user/xstore',
                mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
            },
        };
        const runner = vi.fn<EnDevXDpuWslCommandRunner>(async () => ({
            exitCode: 0,
            stdout: [
                'MCP=/home/user/.endev/generated/.mcp.json',
                'JSON_BEGIN',
                JSON.stringify({
                    mcpServers: {
                        [ENDEV_XDPU_MCP_SERVER_NAME]: {
                            command: 'funbird-mcp',
                            args: ['serve'],
                            tools: ['*'],
                            timeout: 90_000,
                        },
                    },
                }),
                'JSON_END',
                '',
            ].join('\n'),
            stderr: '',
        }));

        const servers = await resolveEnDevXDpuMcpServers(workspace, runner);

        expect(runner).toHaveBeenCalledOnce();
        expect(runner.mock.calls[0][0].command).toContain('/home/user/.endev/generated/.mcp.json');
        expect(servers).toEqual({
            [ENDEV_XDPU_MCP_SERVER_NAME]: expect.objectContaining({
                type: 'stdio',
                command: path.win32.join(process.env.SystemRoot!, 'System32', 'wsl.exe'),
                args: ['-d', 'Ubuntu', '--cd', '/home/user/xstore', '--', 'funbird-mcp', 'serve'],
                tools: ['*'],
                timeout: 90_000,
            }),
        });
    });

    it('uses native stdio funbird-mcp config when CoC runs inside WSL', async () => {
        setEnDevXDpuHostPlatformForTesting('linux');
        const workspace: WorkspaceInfo = {
            id: 'ws-endev-native-mcp',
            name: 'xStore native WSL',
            rootPath: '/home/user/xstore',
            endevXDpu: {
                enabled: true,
                xstoreRepoRoot: '/home/user/xstore',
                mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
            },
        };
        const runner = vi.fn<EnDevXDpuWslCommandRunner>(async () => ({
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
                '',
            ].join('\n'),
            stderr: '',
        }));

        const servers = await resolveEnDevXDpuMcpServers(workspace, runner);

        expect(runner).toHaveBeenCalledWith(expect.objectContaining({
            distro: undefined,
            linuxWorkingDirectory: '/home/user/xstore',
        }));
        expect(servers).toEqual({
            [ENDEV_XDPU_MCP_SERVER_NAME]: expect.objectContaining({
                type: 'stdio',
                command: 'funbird-mcp',
                args: ['serve'],
                cwd: '/home/user/xstore',
                tools: ['*'],
            }),
        });
    });

    it('searches source and workspace MCP config fallbacks when no path was persisted', async () => {
        const workspace: WorkspaceInfo = {
            id: 'ws-endev-source-mcp',
            name: 'xStore WSL',
            rootPath: String.raw`\\wsl$\Ubuntu\home\user\xstore`,
            endevXDpu: {
                enabled: true,
                wslDistro: 'Ubuntu',
                xstoreRepoRoot: '/home/user/xstore',
            },
        };
        const runner = vi.fn<EnDevXDpuWslCommandRunner>(async (req) => {
            expect(req.command).toContain('"\\$HOME/.endev/source/.mcp.json"');
            expect(req.command).toContain("'./.mcp.json'");
            expect(req.command).toContain('file="\\$1"');
            expect(req.command).toContain('has_funbird_mcp "\\$file"');
            expect(req.command).toContain("-name '.mcp.json'");
            expect(req.command).toContain("'*/.vscode/mcp.json'");
            return {
                exitCode: 0,
                stdout: [
                    'MCP=/home/user/.endev/source/worktrees/xstore/.mcp.json',
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
                    '',
                ].join('\n'),
                stderr: '',
            };
        });

        const servers = await resolveEnDevXDpuMcpServers(workspace, runner);

        expect(servers?.[ENDEV_XDPU_MCP_SERVER_NAME]).toEqual(expect.objectContaining({
            command: path.win32.join(process.env.SystemRoot!, 'System32', 'wsl.exe'),
            args: ['-d', 'Ubuntu', '--cd', '/home/user/xstore', '--', 'funbird-mcp', 'serve'],
            tools: ['*'],
        }));
    });

    it('supports VS Code-style EnDev MCP config shape and bridges Linux env/cwd in WSL', async () => {
        const workspace: WorkspaceInfo = {
            id: 'ws-endev-vscode-mcp',
            name: 'xStore WSL',
            rootPath: String.raw`\\wsl$\Ubuntu\home\user\xstore`,
            endevXDpu: { enabled: true },
        };
        const runner = vi.fn<EnDevXDpuWslCommandRunner>(async () => ({
            exitCode: 0,
            stdout: [
                'MCP=/home/user/.endev/source/.vscode/mcp.json',
                'JSON_BEGIN',
                JSON.stringify({
                    servers: {
                        [ENDEV_XDPU_MCP_SERVER_NAME]: {
                            command: 'python3',
                            args: ['-m', 'funbird_mcp'],
                            env: { FUNBIRD_MODE: 'xstore' },
                            cwd: '/home/user/.endev/mcp-servers/funbird',
                        },
                    },
                }),
                'JSON_END',
            ].join('\n'),
            stderr: '',
        }));

        const servers = await resolveEnDevXDpuMcpServers(workspace, runner);
        const bridged = servers?.[ENDEV_XDPU_MCP_SERVER_NAME] as { args: string[] } | undefined;

        expect(bridged?.args.slice(0, 4)).toEqual(['-d', 'Ubuntu', '--cd', '/home/user/xstore']);
        expect(bridged?.args.slice(4, 7)).toEqual(['--', 'sh', '-lc']);
        expect(bridged?.args[7]).toContain("cd '/home/user/.endev/mcp-servers/funbird' && FUNBIRD_MODE='xstore'");
        expect(bridged?.args[7]).toContain("'python3' '-m' 'funbird_mcp'");
        expect(servers?.[ENDEV_XDPU_MCP_SERVER_NAME]).toEqual(expect.objectContaining({
            tools: ['*'],
        }));
    });

    it('rejects non-WSL workspace roots before running EnDev commands', async () => {
        const store = new FileProcessStore({ dataDir });
        const runner = vi.fn<EnDevXDpuWslCommandRunner>();
        const workspace: WorkspaceInfo = {
            id: 'ws-windows',
            name: 'Windows repo',
            rootPath: String.raw`C:\repo`,
            endevXDpu: { enabled: true, wslDistro: 'Ubuntu', xstoreRepoRoot: '/home/user/xstore' },
        };

        await expect(activateEnDevXDpuWorkspace(store, workspace, dataDir, runner))
            .rejects.toMatchObject({
                code: 'ENDEV_XDPU_UNSUPPORTED_WORKSPACE',
            } satisfies Partial<EnDevXDpuSetupError>);
        expect(runner).not.toHaveBeenCalled();
    });

    it('surfaces actionable endev doctor failures with command output details', async () => {
        const store = new FileProcessStore({ dataDir });
        const workspace: WorkspaceInfo = {
            id: 'ws-endev-doctor-fail',
            name: 'xStore WSL',
            rootPath: String.raw`\\wsl$\Ubuntu\home\user\xstore`,
            endevXDpu: { enabled: true },
        };
        const runner = vi.fn<EnDevXDpuWslCommandRunner>(async () => ({
            exitCode: 42,
            stdout: 'missing Azure login',
            stderr: 'run az login',
        }));

        await expect(activateEnDevXDpuWorkspace(store, workspace, dataDir, runner))
            .rejects.toMatchObject({
                code: 'ENDEV_XDPU_DOCTOR_FAILED',
                details: expect.objectContaining({
                    exitCode: 42,
                    stdout: 'missing Azure login',
                    stderr: 'run az login',
                }),
            } satisfies Partial<EnDevXDpuSetupError>);
    });

    it('exposes activation through the workspace API and lists the generated global wrapper skill', async () => {
        const store = new FileProcessStore({ dataDir });
        await store.registerWorkspace({
            id: 'ws-api',
            name: 'xStore WSL',
            rootPath: String.raw`\\wsl$\Ubuntu\home\user\xstore`,
            endevXDpu: { enabled: true },
        });
        setEnDevXDpuWslCommandRunnerForTesting(createSuccessfulRunner());

        const routes: Route[] = [];
        registerApiRoutes(routes, store, undefined, dataDir);
        const server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const port = (server.address() as { port: number }).port;
            const base = `http://127.0.0.1:${port}`;
            const activation = await request(`${base}/api/workspaces/ws-api/endev-xdpu/discover`, { method: 'POST' });
            expect(activation.status).toBe(200);
            expect(activation.json().workspace.extraSkillFolders).toEqual([
                String.raw`\\wsl$\Ubuntu\home\user\xstore\Developer\private\EnDpuDev\plugin\skills`,
            ]);

            const skills = await request(`${base}/api/skills`);
            expect(skills.status).toBe(200);
            expect(skills.json().skills.map((skill: { name: string }) => skill.name)).toContain(ENDEV_XDPU_WRAPPER_SKILL_NAME);
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    });
});
