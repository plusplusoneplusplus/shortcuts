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
    ENDEV_XDPU_WRAPPER_SKILL_NAME,
    EnDevXDpuSetupError,
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

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'endev-xdpu-test-'));
        setEnDevXDpuWslCommandRunnerForTesting(undefined);
    });

    afterEach(() => {
        setEnDevXDpuWslCommandRunnerForTesting(undefined);
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

        const wrapperPath = path.join(dataDir, 'skills', ENDEV_XDPU_WRAPPER_SKILL_NAME, 'SKILL.md');
        expect(result.wrapperSkillPath).toBe(wrapperPath);
        expect(fs.readFileSync(wrapperPath, 'utf-8')).toContain(`name: ${ENDEV_XDPU_WRAPPER_SKILL_NAME}`);
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
