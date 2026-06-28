/**
 * Tests for skill-config-resolver — resolveSkillConfig()
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Capture real homedir before any mock takes effect.
// Must use `var` because vi.mock factories are hoisted above `let`/`const` declarations.
// eslint-disable-next-line no-var
var _realHomedir: string;

vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal<typeof import('os')>();
    _realHomedir = actual.homedir();
    return {
        ...actual,
        homedir: vi.fn(() => _realHomedir),
    };
});

import { resolveSkillConfig } from '../../../src/server/executors/skill-config-resolver';
import { getBundledSkillsPath } from '@plusplusoneplusplus/forge';
import { createMockProcessStore } from '../helpers/mock-process-store';

describe('resolveSkillConfig', () => {
    let tmpDir: string;
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-cfg-'));
        store = createMockProcessStore({ initialWorkspaces: [] });
        // Ensure each test starts with the real homedir as default
        vi.mocked(os.homedir).mockImplementation(() => _realHomedir);
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

    describe('OneDrive skill directories', () => {
        it('includes OneDrive skill dir when it exists', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const oneDriveSkillsDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
            fs.mkdirSync(oneDriveSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined);

            expect(result.skillDirectories).toBeDefined();
            expect(result.skillDirectories).toContain(oneDriveSkillsDir);
        });

        it('includes OneDrive - Microsoft skill dir when it exists', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const oneDriveMsSkillsDir = path.join(fakeHome, 'OneDrive - Microsoft', '.github', 'skills');
            fs.mkdirSync(oneDriveMsSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined);

            expect(result.skillDirectories).toBeDefined();
            expect(result.skillDirectories).toContain(oneDriveMsSkillsDir);
        });

        it('includes both OneDrive variants when both exist', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const oneDriveSkillsDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
            const oneDriveMsSkillsDir = path.join(fakeHome, 'OneDrive - Microsoft', '.github', 'skills');
            fs.mkdirSync(oneDriveSkillsDir, { recursive: true });
            fs.mkdirSync(oneDriveMsSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined);

            expect(result.skillDirectories).toBeDefined();
            expect(result.skillDirectories).toContain(oneDriveSkillsDir);
            expect(result.skillDirectories).toContain(oneDriveMsSkillsDir);
        });

        it('skips OneDrive skill dirs that do not exist', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            fs.mkdirSync(fakeHome, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined);

            const dirs = result.skillDirectories ?? [];
            const oneDriveSkillsDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
            const oneDriveMsSkillsDir = path.join(fakeHome, 'OneDrive - Microsoft', '.github', 'skills');
            expect(dirs).not.toContain(oneDriveSkillsDir);
            expect(dirs).not.toContain(oneDriveMsSkillsDir);
        });

        it('OneDrive dirs appear after global and before bundled', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const oneDriveSkillsDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
            fs.mkdirSync(oneDriveSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const dataDir = path.join(tmpDir, 'data');
            const globalSkillsDir = path.join(dataDir, 'skills');
            fs.mkdirSync(globalSkillsDir, { recursive: true });

            const result = await resolveSkillConfig(store, dataDir, undefined, undefined);

            const bundledDir = getBundledSkillsPath();
            if (fs.existsSync(bundledDir)) {
                const dirs = result.skillDirectories!;
                const globalIdx = dirs.indexOf(globalSkillsDir);
                const oneDriveIdx = dirs.indexOf(oneDriveSkillsDir);
                const bundledIdx = dirs.indexOf(bundledDir);
                expect(globalIdx).toBeLessThan(oneDriveIdx);
                expect(oneDriveIdx).toBeLessThan(bundledIdx);
            }
        });
    });
});
