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

import { resolveSkillConfig, resolveDefaultOneDriveSkillDirs, expandHomePath, resolveEffectiveSkillPaths } from '../../../src/server/executors/skill-config-resolver';
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

    describe('multi-workspace isolation (AC #3)', () => {
        // Two workspaces, each with its own per-repo extra skill folder. Runtime
        // resolution must include only the *selected* workspace's extra folders,
        // proving per-repo extraSkillFolders never leak between workspaces.
        // dataDir is omitted so getEffectiveEnDevExtraSkillFolders returns the
        // workspace's extraSkillFolders verbatim (no EnDev detection side effects).
        function makeIsolationStore(wsAExtra: string, wsBExtra: string) {
            return createMockProcessStore({
                initialWorkspaces: [
                    { id: 'ws-a', name: 'Repo A', rootPath: path.join(tmpDir, 'repo-a'), extraSkillFolders: [wsAExtra] },
                    { id: 'ws-b', name: 'Repo B', rootPath: path.join(tmpDir, 'repo-b'), extraSkillFolders: [wsBExtra] },
                ] as any,
            });
        }

        // Empty fake home so no host OneDrive/CloudStorage folders enter results.
        function useEmptyHome(): void {
            const fakeHome = path.join(tmpDir, 'home');
            fs.mkdirSync(fakeHome, { recursive: true });
            vi.mocked(os.homedir).mockReturnValue(fakeHome);
        }

        it("includes only the selected workspace's extra skill folders (no leak between workspaces)", async () => {
            const wsAExtra = path.join(tmpDir, 'ws-a-extra');
            const wsBExtra = path.join(tmpDir, 'ws-b-extra');
            fs.mkdirSync(wsAExtra, { recursive: true });
            fs.mkdirSync(wsBExtra, { recursive: true });
            useEmptyHome();

            const isoStore = makeIsolationStore(wsAExtra, wsBExtra);

            // Resolving for workspace A includes A's extra folder but not B's.
            const resultA = await resolveSkillConfig(isoStore, undefined, 'ws-a', undefined);
            expect(resultA.skillDirectories ?? []).toContain(wsAExtra);
            expect(resultA.skillDirectories ?? []).not.toContain(wsBExtra);

            // Resolving for workspace B includes B's extra folder but not A's.
            const resultB = await resolveSkillConfig(isoStore, undefined, 'ws-b', undefined);
            expect(resultB.skillDirectories ?? []).toContain(wsBExtra);
            expect(resultB.skillDirectories ?? []).not.toContain(wsAExtra);
        });

        it('applies configured global extra folders to every workspace while keeping per-repo extras scoped', async () => {
            const globalExtra = path.join(tmpDir, 'global-extra');
            const wsAExtra = path.join(tmpDir, 'ws-a-extra');
            const wsBExtra = path.join(tmpDir, 'ws-b-extra');
            [globalExtra, wsAExtra, wsBExtra].forEach(d => fs.mkdirSync(d, { recursive: true }));
            useEmptyHome();

            const isoStore = makeIsolationStore(wsAExtra, wsBExtra);
            const options = { globalExtraFolders: [globalExtra], autoDetectDefaultFolders: false };

            const resultA = await resolveSkillConfig(isoStore, undefined, 'ws-a', undefined, options);
            expect(resultA.skillDirectories ?? []).toContain(globalExtra); // global applies to A
            expect(resultA.skillDirectories ?? []).toContain(wsAExtra);     // A's own per-repo extra
            expect(resultA.skillDirectories ?? []).not.toContain(wsBExtra); // B's extra must not leak into A

            const resultB = await resolveSkillConfig(isoStore, undefined, 'ws-b', undefined, options);
            expect(resultB.skillDirectories ?? []).toContain(globalExtra); // same global folder applies to B too
            expect(resultB.skillDirectories ?? []).toContain(wsBExtra);
            expect(resultB.skillDirectories ?? []).not.toContain(wsAExtra);
        });

        it("applies only the selected workspace's disabled skills", async () => {
            const isoStore = createMockProcessStore({
                initialWorkspaces: [
                    { id: 'ws-a', name: 'Repo A', rootPath: path.join(tmpDir, 'repo-a'), disabledSkills: ['skill-a'] },
                    { id: 'ws-b', name: 'Repo B', rootPath: path.join(tmpDir, 'repo-b'), disabledSkills: ['skill-b'] },
                ] as any,
            });

            const resultA = await resolveSkillConfig(isoStore, undefined, 'ws-a', undefined);
            expect(resultA.disabledSkills).toContain('skill-a');
            expect(resultA.disabledSkills ?? []).not.toContain('skill-b');

            const resultB = await resolveSkillConfig(isoStore, undefined, 'ws-b', undefined);
            expect(resultB.disabledSkills).toContain('skill-b');
            expect(resultB.disabledSkills ?? []).not.toContain('skill-a');
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

describe('resolveEffectiveSkillPaths', () => {
    let tmpDir: string;
    let fakeHome: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eff-paths-'));
        // Empty fake home so no real OneDrive/CloudStorage folders are detected.
        fakeHome = path.join(tmpDir, 'home');
        fs.mkdirSync(fakeHome, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function makeSkill(dir: string, name: string): void {
        const skillDir = path.join(dir, name);
        fs.mkdirSync(skillDir, { recursive: true });
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `# ${name}\nDesc`);
    }

    it('returns global-only entries when no workspace root is supplied', async () => {
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(path.join(dataDir, 'skills'), { recursive: true });

        const entries = await resolveEffectiveSkillPaths({ dataDir, homedir: fakeHome });

        expect(entries.every(e => e.scope === 'global')).toBe(true);
        expect(entries.some(e => e.source === 'repo')).toBe(false);
        expect(entries.some(e => e.source === 'repo-extra')).toBe(false);
        expect(entries.some(e => e.source === 'managed-global')).toBe(true);
    });

    it('marks a missing managed-global directory as missing', async () => {
        const dataDir = path.join(tmpDir, 'data'); // no skills subdir created
        const entries = await resolveEffectiveSkillPaths({ dataDir, homedir: fakeHome });
        const managed = entries.find(e => e.source === 'managed-global')!;
        expect(managed.status).toBe('missing');
        expect(managed.skillCount).toBeUndefined();
    });

    it('marks an empty managed-global directory as no-skills', async () => {
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
        const entries = await resolveEffectiveSkillPaths({ dataDir, homedir: fakeHome });
        const managed = entries.find(e => e.source === 'managed-global')!;
        expect(managed.status).toBe('no-skills');
        expect(managed.skillCount).toBe(0);
    });

    it('counts skills in the managed-global directory', async () => {
        const dataDir = path.join(tmpDir, 'data');
        const skillsDir = path.join(dataDir, 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        makeSkill(skillsDir, 'one');
        makeSkill(skillsDir, 'two');
        const entries = await resolveEffectiveSkillPaths({ dataDir, homedir: fakeHome });
        const managed = entries.find(e => e.source === 'managed-global')!;
        expect(managed.status).toBe('available');
        expect(managed.skillCount).toBe(2);
    });

    it('includes a workspace-scoped repo path before managed-global when a workspace root is given', async () => {
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
        const repoRoot = path.join(tmpDir, 'repo');
        makeSkill(path.join(repoRoot, '.github', 'skills'), 'repo-one');

        const entries = await resolveEffectiveSkillPaths({ dataDir, homedir: fakeHome, workspaceRootPath: repoRoot });

        const repo = entries.find(e => e.source === 'repo')!;
        expect(repo.scope).toBe('workspace');
        expect(repo.status).toBe('available');
        expect(repo.skillCount).toBe(1);
        const repoIdx = entries.findIndex(e => e.source === 'repo');
        const managedIdx = entries.findIndex(e => e.source === 'managed-global');
        expect(repoIdx).toBeLessThan(managedIdx);
    });

    it('includes per-repo extra folders (workspace scope) after configured global folders', async () => {
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
        const repoRoot = path.join(tmpDir, 'repo');
        fs.mkdirSync(repoRoot, { recursive: true });
        const globalExtra = path.join(tmpDir, 'global-extra');
        fs.mkdirSync(globalExtra, { recursive: true });
        const repoExtra = path.join(tmpDir, 'repo-extra');
        fs.mkdirSync(repoExtra, { recursive: true });

        const entries = await resolveEffectiveSkillPaths({
            dataDir,
            homedir: fakeHome,
            workspaceRootPath: repoRoot,
            extraSkillFolders: [repoExtra],
            globalExtraFolders: [globalExtra],
            autoDetectDefaultFolders: false,
        });

        const configuredIdx = entries.findIndex(e => e.source === 'configured');
        const repoExtraIdx = entries.findIndex(e => e.source === 'repo-extra');
        expect(configuredIdx).toBeGreaterThanOrEqual(0);
        expect(repoExtraIdx).toBeGreaterThan(configuredIdx);
        expect(entries[repoExtraIdx].scope).toBe('workspace');
    });

    it('classifies configured global extra folders as available, missing, or skipped', async () => {
        const existing = path.join(tmpDir, 'existing-extra');
        makeSkill(existing, 'x');
        const missing = path.join(tmpDir, 'missing-extra');

        const entries = await resolveEffectiveSkillPaths({
            homedir: fakeHome,
            globalExtraFolders: [existing, missing, 'relative/skills'],
        });

        const configured = entries.filter(e => e.source === 'configured');
        expect(configured.find(e => e.path === existing)!.status).toBe('available');
        expect(configured.find(e => e.path === missing)!.status).toBe('missing');
        const rel = configured.find(e => e.path === 'relative/skills')!;
        expect(rel.status).toBe('skipped');
        expect(rel.note).toBeTruthy();
    });

    it('expands ~ in configured global extra folders', async () => {
        const extra = path.join(fakeHome, 'team-skills');
        makeSkill(extra, 'y');
        const entries = await resolveEffectiveSkillPaths({
            homedir: fakeHome,
            globalExtraFolders: ['~/team-skills'],
        });
        const configured = entries.find(e => e.source === 'configured')!;
        expect(configured.path).toBe(extra);
        expect(configured.status).toBe('available');
    });

    it('skips auto-detected OneDrive folders when auto-detection is disabled', async () => {
        const oneDrive = path.join(fakeHome, 'OneDrive', '.github', 'skills');
        fs.mkdirSync(oneDrive, { recursive: true });
        const entries = await resolveEffectiveSkillPaths({ homedir: fakeHome, autoDetectDefaultFolders: false });
        expect(entries.some(e => e.source === 'auto-detected')).toBe(false);
    });

    it('surfaces an existing auto-detected OneDrive folder when detection is enabled', async () => {
        const oneDrive = path.join(fakeHome, 'OneDrive', '.github', 'skills');
        makeSkill(oneDrive, 'od-skill');
        const entries = await resolveEffectiveSkillPaths({ homedir: fakeHome, autoDetectDefaultFolders: true });
        const detected = entries.find(e => e.source === 'auto-detected');
        expect(detected).toBeTruthy();
        expect(detected!.path).toBe(oneDrive);
        expect(detected!.scope).toBe('global');
        expect(detected!.status).toBe('available');
        expect(detected!.skillCount).toBe(1);
    });

    it('does not surface missing default OneDrive folders (concise diagnostics)', async () => {
        const entries = await resolveEffectiveSkillPaths({ homedir: fakeHome });
        expect(entries.some(e => e.source === 'auto-detected')).toBe(false);
    });

    it('emits a skipped auto-detected entry when a OneDrive root exists but lacks .github/skills', async () => {
        // Root present, but no .github/skills beneath it (AC #7 diagnostics case).
        const oneDriveRoot = path.join(fakeHome, 'OneDrive');
        fs.mkdirSync(oneDriveRoot, { recursive: true });

        const entries = await resolveEffectiveSkillPaths({ homedir: fakeHome });

        const autoDetected = entries.filter(e => e.source === 'auto-detected');
        // Only the existing root is surfaced; the absent 'OneDrive - Microsoft'
        // root stays silent — so exactly one skipped diagnostic.
        expect(autoDetected).toHaveLength(1);
        const skipped = autoDetected[0];
        expect(skipped.status).toBe('skipped');
        expect(skipped.path).toBe(path.join(oneDriveRoot, '.github', 'skills'));
        expect(skipped.scope).toBe('global');
        expect(skipped.note).toBeTruthy();
        expect(skipped.skillCount).toBeUndefined();
    });

    it('emits a skipped auto-detected entry for a CloudStorage OneDrive root without .github/skills', async () => {
        const cloudRoot = path.join(fakeHome, 'Library', 'CloudStorage', 'OneDrive-Personal');
        fs.mkdirSync(cloudRoot, { recursive: true });

        const entries = await resolveEffectiveSkillPaths({ homedir: fakeHome });

        const skipped = entries.find(e => e.source === 'auto-detected' && e.status === 'skipped');
        expect(skipped).toBeTruthy();
        expect(skipped!.path).toBe(path.join(cloudRoot, '.github', 'skills'));
        expect(skipped!.note).toBeTruthy();
    });

    it('stays silent for an absent OneDrive root (no auto-detected entry)', async () => {
        // fakeHome is empty — no OneDrive root exists at all.
        const entries = await resolveEffectiveSkillPaths({ homedir: fakeHome });
        expect(entries.some(e => e.source === 'auto-detected')).toBe(false);
    });

    it('does not emit skipped auto-detected diagnostics when auto-detection is disabled', async () => {
        const oneDriveRoot = path.join(fakeHome, 'OneDrive');
        fs.mkdirSync(oneDriveRoot, { recursive: true });

        const entries = await resolveEffectiveSkillPaths({ homedir: fakeHome, autoDetectDefaultFolders: false });
        expect(entries.some(e => e.source === 'auto-detected')).toBe(false);
    });

    it('includes the bundled skills directory last as a global source', async () => {
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
        const entries = await resolveEffectiveSkillPaths({ dataDir, homedir: fakeHome });
        const bundledDir = getBundledSkillsPath();
        if (fs.existsSync(bundledDir)) {
            const bundled = entries.find(e => e.source === 'bundled');
            expect(bundled).toBeTruthy();
            expect(bundled!.scope).toBe('global');
            expect(entries[entries.length - 1].source).toBe('bundled');
        }
    });

    it('preserves the full priority order: repo → managed → configured → repo-extra → bundled', async () => {
        const dataDir = path.join(tmpDir, 'data');
        fs.mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
        const repoRoot = path.join(tmpDir, 'repo');
        makeSkill(path.join(repoRoot, '.github', 'skills'), 'r');
        const globalExtra = path.join(tmpDir, 'global-extra');
        fs.mkdirSync(globalExtra, { recursive: true });
        const repoExtra = path.join(tmpDir, 'repo-extra');
        fs.mkdirSync(repoExtra, { recursive: true });

        const entries = await resolveEffectiveSkillPaths({
            dataDir,
            homedir: fakeHome,
            workspaceRootPath: repoRoot,
            extraSkillFolders: [repoExtra],
            globalExtraFolders: [globalExtra],
            autoDetectDefaultFolders: false,
        });

        const order = entries.map(e => e.source);
        const idx = (s: string) => order.indexOf(s);
        expect(idx('repo')).toBeLessThan(idx('managed-global'));
        expect(idx('managed-global')).toBeLessThan(idx('configured'));
        expect(idx('configured')).toBeLessThan(idx('repo-extra'));
        const bundledDir = getBundledSkillsPath();
        if (fs.existsSync(bundledDir)) {
            expect(idx('repo-extra')).toBeLessThan(idx('bundled'));
        }
    });
});
