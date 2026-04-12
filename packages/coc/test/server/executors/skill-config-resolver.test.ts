/**
 * Tests for skill-config-resolver — resolveSkillConfig()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { resolveSkillConfig } from '../../../src/server/executors/skill-config-resolver';
import { getBundledSkillsPath } from '@plusplusoneplusplus/forge';
import { createMockProcessStore } from '../helpers/mock-process-store';

describe('resolveSkillConfig', () => {
    let tmpDir: string;
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cfg-'));
        store = createMockProcessStore({ initialWorkspaces: [] });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('includes bundled skills path as lowest-priority directory', async () => {
        const repoDir = path.join(tmpDir, 'repo');
        const repoSkillsDir = path.join(repoDir, '.github', 'skills');
        fs.mkdirSync(repoSkillsDir, { recursive: true });

        const result = await resolveSkillConfig(store, undefined, undefined, repoDir);

        const bundledDir = getBundledSkillsPath();
        if (fs.existsSync(bundledDir)) {
            expect(result.skillDirectories).toBeDefined();
            expect(result.skillDirectories!).toContain(bundledDir);
            // Bundled should be LAST (lowest priority)
            expect(result.skillDirectories![result.skillDirectories!.length - 1]).toBe(bundledDir);
        }
    });

    it('includes repo and bundled dirs with bundled last', async () => {
        const repoDir = path.join(tmpDir, 'repo');
        const repoSkillsDir = path.join(repoDir, '.github', 'skills');
        fs.mkdirSync(repoSkillsDir, { recursive: true });

        const dataDir = path.join(tmpDir, 'data');
        const globalSkillsDir = path.join(dataDir, 'skills');
        fs.mkdirSync(globalSkillsDir, { recursive: true });

        const result = await resolveSkillConfig(store, dataDir, undefined, repoDir);

        const bundledDir = getBundledSkillsPath();
        if (fs.existsSync(bundledDir)) {
            expect(result.skillDirectories).toBeDefined();
            const dirs = result.skillDirectories!;
            expect(dirs[0]).toBe(repoSkillsDir);
            expect(dirs[1]).toBe(globalSkillsDir);
            expect(dirs[dirs.length - 1]).toBe(bundledDir);
        }
    });

    it('merges globalDisabledSkills from preferences (applies to bundled too)', async () => {
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(
            path.join(dataDir, 'preferences.json'),
            JSON.stringify({ globalDisabledSkills: ['create-work-item', 'go-deep'] }),
        );

        const result = await resolveSkillConfig(store, dataDir, undefined, undefined);
        expect(result.disabledSkills).toBeDefined();
        expect(result.disabledSkills).toContain('create-work-item');
        expect(result.disabledSkills).toContain('go-deep');
    });
});
