import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import {
    detectEnDevEligibility,
    ENDEV_STATUS_CACHE_FILE,
    getEffectiveEnDevExtraSkillFolders,
    isEnDevWrapperSkillVisible,
} from '../../src/server/endev/endev-detector';

describe('EnDev xDPU eligibility detection', () => {
    let dataDir: string;
    let workspaceDir: string;
    let workspace: WorkspaceInfo;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-endev-data-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Storage-xDPU-xStore-'));
        workspace = {
            id: 'ws-xdpu',
            name: 'Storage-xDPU-xStore',
            rootPath: workspaceDir,
        };
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('rejects non-native WSL workspaces before running doctor', async () => {
        fs.mkdirSync(path.join(workspaceDir, '.endev'), { recursive: true });
        const doctorRunner = vi.fn(async () => ({ ok: true }));

        const status = await detectEnDevEligibility(dataDir, workspace, {
            isNativeWsl: false,
            doctorRunner,
        });

        expect(status.eligible).toBe(false);
        expect(status.reason).toBe('not-native-wsl');
        expect(doctorRunner).not.toHaveBeenCalled();
    });

    it('requires xDPU workspace markers before running doctor', async () => {
        const ordinaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordinary-repo-'));
        fs.mkdirSync(path.join(ordinaryDir, '.endev'), { recursive: true });
        const nonXdpuWorkspace = { ...workspace, name: 'ordinary-repo', rootPath: ordinaryDir };
        const doctorRunner = vi.fn(async () => ({ ok: true }));

        try {
            const status = await detectEnDevEligibility(dataDir, nonXdpuWorkspace, {
                isNativeWsl: true,
                doctorRunner,
            });

            expect(status.eligible).toBe(false);
            expect(status.reason).toBe('not-xdpu-workspace');
            expect(doctorRunner).not.toHaveBeenCalled();
        } finally {
            fs.rmSync(ordinaryDir, { recursive: true, force: true });
        }
    });

    it('requires EnDev setup files before running doctor', async () => {
        const doctorRunner = vi.fn(async () => ({ ok: true }));

        const status = await detectEnDevEligibility(dataDir, workspace, {
            isNativeWsl: true,
            doctorRunner,
        });

        expect(status.eligible).toBe(false);
        expect(status.reason).toBe('missing-setup-files');
        expect(doctorRunner).not.toHaveBeenCalled();
    });

    it('marks eligible setup after endev doctor succeeds and caches the result', async () => {
        fs.mkdirSync(path.join(workspaceDir, '.endev', 'copilot', 'skills'), { recursive: true });
        const doctorRunner = vi.fn(async () => ({ ok: true, stdout: 'healthy' }));

        const first = await detectEnDevEligibility(dataDir, workspace, {
            isNativeWsl: true,
            doctorRunner,
        });
        const second = await detectEnDevEligibility(dataDir, workspace, {
            isNativeWsl: true,
            doctorRunner,
        });

        expect(first.eligible).toBe(true);
        expect(first.reason).toBe('eligible');
        expect(first.pluginSkillFolder).toBe(path.join(workspaceDir, '.endev', 'copilot', 'skills'));
        expect(second.cached).toBe(true);
        expect(doctorRunner).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(getRepoDataPath(dataDir, workspace.id, ENDEV_STATUS_CACHE_FILE))).toBe(true);
    });

    it('forceRefresh re-runs doctor instead of using the cache', async () => {
        fs.mkdirSync(path.join(workspaceDir, '.endev'), { recursive: true });
        const doctorRunner = vi.fn(async () => ({ ok: true }));

        await detectEnDevEligibility(dataDir, workspace, {
            isNativeWsl: true,
            doctorRunner,
        });
        await detectEnDevEligibility(dataDir, workspace, {
            forceRefresh: true,
            isNativeWsl: true,
            doctorRunner,
        });

        expect(doctorRunner).toHaveBeenCalledTimes(2);
    });

    it('reports doctor failures as ineligible', async () => {
        fs.mkdirSync(path.join(workspaceDir, '.endev'), { recursive: true });

        const status = await detectEnDevEligibility(dataDir, workspace, {
            isNativeWsl: true,
            doctorRunner: async () => ({ ok: false, exitCode: 1, stderr: 'bad setup' }),
        });

        expect(status.eligible).toBe(false);
        expect(status.reason).toBe('doctor-failed');
        expect(status.doctor?.stderr).toBe('bad setup');
    });

    it('adds detected plugin skills folder without persisting the wrapper preference', async () => {
        const pluginSkillsDir = path.join(workspaceDir, '.endev', 'copilot', 'skills');
        fs.mkdirSync(pluginSkillsDir, { recursive: true });
        await detectEnDevEligibility(dataDir, workspace, {
            isNativeWsl: true,
            doctorRunner: async () => ({ ok: true }),
        });

        const folders = await getEffectiveEnDevExtraSkillFolders(dataDir, workspace);

        expect(folders).toContain(pluginSkillsDir);
        await expect(isEnDevWrapperSkillVisible(dataDir, workspace)).resolves.toBe(true);
    });

    it('hides the wrapper skill when the workspace is ineligible', async () => {
        await detectEnDevEligibility(dataDir, workspace, {
            isNativeWsl: false,
            doctorRunner: async () => ({ ok: true }),
        });

        await expect(isEnDevWrapperSkillVisible(dataDir, workspace)).resolves.toBe(false);
    });
});
