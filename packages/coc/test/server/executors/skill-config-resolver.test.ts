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

import { resolveSkillConfig, resolveDefaultOneDriveSkillDirs, expandHomePath } from '../../../src/server/executors/skill-config-resolver';
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

    describe('macOS CloudStorage OneDrive skill directories', () => {
        it('includes a macOS CloudStorage OneDrive skill dir when it exists', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const cloudSkillsDir = path.join(
                fakeHome, 'Library', 'CloudStorage', 'OneDrive-Personal', '.github', 'skills',
            );
            fs.mkdirSync(cloudSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined);

            expect(result.skillDirectories).toBeDefined();
            expect(result.skillDirectories).toContain(cloudSkillsDir);
        });

        it('includes multiple CloudStorage OneDrive roots when several exist', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const personalSkillsDir = path.join(
                fakeHome, 'Library', 'CloudStorage', 'OneDrive-Personal', '.github', 'skills',
            );
            const bizSkillsDir = path.join(
                fakeHome, 'Library', 'CloudStorage', 'OneDrive-Contoso', '.github', 'skills',
            );
            fs.mkdirSync(personalSkillsDir, { recursive: true });
            fs.mkdirSync(bizSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined);

            expect(result.skillDirectories).toBeDefined();
            expect(result.skillDirectories).toContain(personalSkillsDir);
            expect(result.skillDirectories).toContain(bizSkillsDir);
        });

        it('skips a CloudStorage OneDrive root that lacks .github/skills', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            // Root exists but no .github/skills beneath it (AC #7 diagnostics case).
            const oneDriveRoot = path.join(fakeHome, 'Library', 'CloudStorage', 'OneDrive-Personal');
            fs.mkdirSync(oneDriveRoot, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined);

            const dirs = result.skillDirectories ?? [];
            const expectedSkillsDir = path.join(oneDriveRoot, '.github', 'skills');
            expect(dirs).not.toContain(expectedSkillsDir);
        });

        it('ignores non-OneDrive CloudStorage providers', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const googleSkillsDir = path.join(
                fakeHome, 'Library', 'CloudStorage', 'GoogleDrive-user', '.github', 'skills',
            );
            fs.mkdirSync(googleSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined);

            const dirs = result.skillDirectories ?? [];
            expect(dirs).not.toContain(googleSkillsDir);
        });

        it('CloudStorage OneDrive dirs appear after global and before bundled', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const cloudSkillsDir = path.join(
                fakeHome, 'Library', 'CloudStorage', 'OneDrive-Personal', '.github', 'skills',
            );
            fs.mkdirSync(cloudSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const dataDir = path.join(tmpDir, 'data');
            const globalSkillsDir = path.join(dataDir, 'skills');
            fs.mkdirSync(globalSkillsDir, { recursive: true });

            const result = await resolveSkillConfig(store, dataDir, undefined, undefined);

            const bundledDir = getBundledSkillsPath();
            if (fs.existsSync(bundledDir)) {
                const dirs = result.skillDirectories!;
                const globalIdx = dirs.indexOf(globalSkillsDir);
                const cloudIdx = dirs.indexOf(cloudSkillsDir);
                const bundledIdx = dirs.indexOf(bundledDir);
                expect(globalIdx).toBeLessThan(cloudIdx);
                expect(cloudIdx).toBeLessThan(bundledIdx);
            }
        });
    });

    describe('resolveDefaultOneDriveSkillDirs helper', () => {
        it('always returns the two Windows-style OneDrive candidates', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            fs.mkdirSync(fakeHome, { recursive: true });

            const dirs = await resolveDefaultOneDriveSkillDirs(fakeHome);

            expect(dirs).toContain(path.join(fakeHome, 'OneDrive', '.github', 'skills'));
            expect(dirs).toContain(path.join(fakeHome, 'OneDrive - Microsoft', '.github', 'skills'));
        });

        it('appends CloudStorage OneDrive candidates after the Windows-style ones', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const cloudRoot = path.join(fakeHome, 'Library', 'CloudStorage', 'OneDrive-Personal');
            fs.mkdirSync(cloudRoot, { recursive: true });

            const dirs = await resolveDefaultOneDriveSkillDirs(fakeHome);

            const cloudSkillsDir = path.join(cloudRoot, '.github', 'skills');
            expect(dirs).toContain(cloudSkillsDir);
            const windowsIdx = dirs.indexOf(path.join(fakeHome, 'OneDrive - Microsoft', '.github', 'skills'));
            expect(dirs.indexOf(cloudSkillsDir)).toBeGreaterThan(windowsIdx);
        });

        it('returns only Windows-style candidates when no CloudStorage dir exists', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            fs.mkdirSync(fakeHome, { recursive: true });

            const dirs = await resolveDefaultOneDriveSkillDirs(fakeHome);

            expect(dirs).toHaveLength(2);
        });
    });

    describe('autoDetectDefaultFolders option', () => {
        it('skips OneDrive detection when autoDetectDefaultFolders is false', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const oneDriveSkillsDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
            fs.mkdirSync(oneDriveSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined, {
                autoDetectDefaultFolders: false,
            });

            const dirs = result.skillDirectories ?? [];
            expect(dirs).not.toContain(oneDriveSkillsDir);
        });

        it('detects OneDrive folders when autoDetectDefaultFolders is true', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const oneDriveSkillsDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
            fs.mkdirSync(oneDriveSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined, {
                autoDetectDefaultFolders: true,
            });

            expect(result.skillDirectories).toContain(oneDriveSkillsDir);
        });

        it('detects OneDrive folders when options are omitted (default on)', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const oneDriveSkillsDir = path.join(fakeHome, 'OneDrive', '.github', 'skills');
            fs.mkdirSync(oneDriveSkillsDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined);

            expect(result.skillDirectories).toContain(oneDriveSkillsDir);
        });
    });

    describe('globalExtraFolders option', () => {
        it('includes a configured absolute global extra folder when it exists', async () => {
            const extraDir = path.join(tmpDir, 'shared-skills');
            fs.mkdirSync(extraDir, { recursive: true });

            const result = await resolveSkillConfig(store, undefined, undefined, undefined, {
                globalExtraFolders: [extraDir],
            });

            expect(result.skillDirectories).toBeDefined();
            expect(result.skillDirectories).toContain(extraDir);
        });

        it('expands a ~-prefixed global extra folder against the home directory', async () => {
            const fakeHome = path.join(tmpDir, 'home');
            const extraDir = path.join(fakeHome, 'team-skills');
            fs.mkdirSync(extraDir, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, undefined, undefined, undefined, {
                globalExtraFolders: ['~/team-skills'],
            });

            expect(result.skillDirectories).toBeDefined();
            expect(result.skillDirectories).toContain(extraDir);
        });

        it('skips a configured global extra folder that does not exist', async () => {
            const missingDir = path.join(tmpDir, 'does-not-exist');

            const result = await resolveSkillConfig(store, undefined, undefined, undefined, {
                globalExtraFolders: [missingDir],
            });

            const dirs = result.skillDirectories ?? [];
            expect(dirs).not.toContain(missingDir);
        });

        it('skips relative global extra folders (must be absolute)', async () => {
            const result = await resolveSkillConfig(store, undefined, undefined, undefined, {
                globalExtraFolders: ['relative/skills'],
            });

            const dirs = result.skillDirectories ?? [];
            expect(dirs).not.toContain('relative/skills');
        });

        it('ignores empty and non-string entries without throwing', async () => {
            const extraDir = path.join(tmpDir, 'shared-skills');
            fs.mkdirSync(extraDir, { recursive: true });

            const result = await resolveSkillConfig(store, undefined, undefined, undefined, {
                // Invalid config shape: empty string, whitespace, and non-string entries.
                globalExtraFolders: ['', '   ', 42 as unknown as string, extraDir],
            });

            expect(result.skillDirectories).toContain(extraDir);
        });

        it('tolerates a non-array globalExtraFolders payload', async () => {
            const result = await resolveSkillConfig(store, undefined, undefined, undefined, {
                globalExtraFolders: 'not-an-array' as unknown as string[],
            });

            // Should not throw; simply contributes no extra folders.
            expect(result).toBeDefined();
        });

        it('orders configured global extra folders after global and before bundled', async () => {
            const dataDir = path.join(tmpDir, 'data');
            const globalSkillsDir = path.join(dataDir, 'skills');
            fs.mkdirSync(globalSkillsDir, { recursive: true });

            const extraDir = path.join(tmpDir, 'shared-skills');
            fs.mkdirSync(extraDir, { recursive: true });

            // Avoid picking up any real OneDrive folders on the host.
            const fakeHome = path.join(tmpDir, 'home');
            fs.mkdirSync(fakeHome, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);

            const result = await resolveSkillConfig(store, dataDir, undefined, undefined, {
                globalExtraFolders: [extraDir],
            });

            const bundledDir = getBundledSkillsPath();
            const dirs = result.skillDirectories!;
            const globalIdx = dirs.indexOf(globalSkillsDir);
            const extraIdx = dirs.indexOf(extraDir);
            expect(globalIdx).toBeLessThan(extraIdx);
            if (fs.existsSync(bundledDir)) {
                expect(extraIdx).toBeLessThan(dirs.indexOf(bundledDir));
            }
        });
    });

    describe('expandHomePath helper', () => {
        it('maps a bare ~ to the home directory', () => {
            expect(expandHomePath('~', '/home/alice')).toBe('/home/alice');
        });

        it('joins ~/x beneath the home directory', () => {
            expect(expandHomePath('~/skills', '/home/alice')).toBe(path.join('/home/alice', 'skills'));
        });

        it('leaves absolute paths untouched', () => {
            expect(expandHomePath('/opt/skills', '/home/alice')).toBe('/opt/skills');
        });
    });
});
