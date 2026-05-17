import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { resolveRunWorkspaceIntegration } from '../../src/commands/run';
import {
    ENDEV_XDPU_MCP_SERVER_NAME,
    setEnDevXDpuHostPlatformForTesting,
    setEnDevXDpuWslCommandRunnerForTesting,
} from '../../src/server/endev/endev-xdpu';
import type { EnDevXDpuWslCommandRunner } from '../../src/server/endev/endev-xdpu';
import { createMockProcessStore } from '../helpers/mock-process-store';

const WSL_ROOT = String.raw`\\wsl$\Ubuntu\home\user\xstore`;

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

describe('resolveRunWorkspaceIntegration', () => {
    let tmpDir: string;
    let originalSystemRoot: string | undefined;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-run-workspace-'));
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
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('resolves host-readable workspace extra skill folders for workflow prompt injection', async () => {
        const repoDir = path.join(tmpDir, 'repo');
        const repoSkillsDir = path.join(repoDir, '.github', 'skills');
        const dataDir = path.join(tmpDir, 'data');
        const globalSkillsDir = path.join(dataDir, 'skills');
        const extraSkillsDir = path.join(tmpDir, 'endev-plugin-skills');
        fs.mkdirSync(repoSkillsDir, { recursive: true });
        fs.mkdirSync(globalSkillsDir, { recursive: true });
        fs.mkdirSync(extraSkillsDir, { recursive: true });

        const store = createMockProcessStore();
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                id: 'ws-local',
                name: 'Local workspace',
                rootPath: repoDir,
                disabledSkills: ['legacy-skill'],
                extraSkillFolders: [extraSkillsDir],
            },
        ] satisfies WorkspaceInfo[]);

        const result = await resolveRunWorkspaceIntegration(store, dataDir, repoDir, { includeMcp: false });

        expect(result.disabledSkills).toEqual(['legacy-skill']);
        expect(result.skillDirectories).toEqual(expect.arrayContaining([
            repoSkillsDir,
            globalSkillsDir,
            extraSkillsDir,
        ]));
        expect(result.mcpServers).toBeUndefined();
    });

    it('bridges EnDev funbird-mcp for enabled WSL workspaces without global MCP config', async () => {
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
        const store = createMockProcessStore();
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([
            {
                id: 'ws-endev',
                name: 'xStore',
                rootPath: WSL_ROOT,
                endevXDpu: {
                    enabled: true,
                    wslDistro: 'Ubuntu',
                    xstoreRepoRoot: '/home/user/xstore',
                    mcpConfigPath: '/home/user/.endev/generated/.mcp.json',
                },
            },
        ] satisfies WorkspaceInfo[]);
        const runner = createMcpRunner();
        setEnDevXDpuWslCommandRunnerForTesting(runner);

        const result = await resolveRunWorkspaceIntegration(store, dataDir, WSL_ROOT);

        expect(runner).toHaveBeenCalledOnce();
        expect(result.mcpServers).toEqual({
            [ENDEV_XDPU_MCP_SERVER_NAME]: expect.objectContaining({
                type: 'stdio',
                command: path.win32.join(process.env.SystemRoot!, 'System32', 'wsl.exe'),
                args: ['-d', 'Ubuntu', '--cd', '/home/user/xstore', '--', 'funbird-mcp', 'serve'],
            }),
        });
    });
});
