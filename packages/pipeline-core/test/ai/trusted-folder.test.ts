/**
 * Trusted Folder Tests
 *
 * Tests for the trusted folder management that auto-registers working
 * directories in ~/.copilot/config.json to bypass the folder trust dialog.
 *
 * NOTE: On Windows, path.resolve('/some/project') produces 'D:\some\project'
 * (prepends the current drive letter). The helper `p()` normalizes Unix-style
 * paths so assertions work cross-platform.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    ensureFolderTrusted,
    isFolderTrusted,
    getCopilotConfigPath,
    setTrustedFolderHomeOverride,
} from '../../src/copilot-sdk-wrapper/trusted-folder';

/**
 * Normalize a Unix-style path to the platform's format.
 * On Windows, path.resolve('/foo') → 'D:\foo'; on Unix it's a no-op.
 */
function p(unixPath: string): string {
    return path.resolve(unixPath);
}

describe('Trusted Folder Management', () => {
    let tempDir: string;
    let configDir: string;
    let configPath: string;

    beforeEach(() => {
        // Create a temp home directory for isolation
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trusted-folder-test-'));
        configDir = path.join(tempDir, '.copilot');
        configPath = path.join(configDir, 'config.json');
        setTrustedFolderHomeOverride(tempDir);
    });

    afterEach(() => {
        setTrustedFolderHomeOverride(null);
        // Cleanup
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // ========================================================================
    // getCopilotConfigPath
    // ========================================================================

    describe('getCopilotConfigPath', () => {
        it('should return path under overridden home directory', () => {
            const result = getCopilotConfigPath();
            expect(result).toBe(configPath);
        });
    });

    // ========================================================================
    // ensureFolderTrusted
    // ========================================================================

    describe('ensureFolderTrusted', () => {
        it('should create config directory and file if they do not exist', () => {
            expect(fs.existsSync(configDir)).toBe(false);

            ensureFolderTrusted('/some/project');

            expect(fs.existsSync(configPath)).toBe(true);
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toContain(p('/some/project'));
        });

        it('should add folder to existing config with no trusted_folders', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({ model: 'gpt-5' }), 'utf-8');

            ensureFolderTrusted('/my/project');

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/my/project')]);
            // Preserve existing fields
            expect(config.model).toBe('gpt-5');
        });

        it('should append folder to existing trusted_folders list', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/existing/path')]
            }), 'utf-8');

            ensureFolderTrusted('/new/path');

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/existing/path'), p('/new/path')]);
        });

        it('should not duplicate an already-trusted folder', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/already/trusted')]
            }), 'utf-8');

            ensureFolderTrusted('/already/trusted');

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/already/trusted')]);
        });

        it('should normalize trailing slashes when comparing', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/my/project')]
            }), 'utf-8');

            // Adding with trailing slash should detect as duplicate
            ensureFolderTrusted('/my/project/');

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/my/project')]);
        });

        it('should handle multiple folders added sequentially', () => {
            ensureFolderTrusted('/project/a');
            ensureFolderTrusted('/project/b');
            ensureFolderTrusted('/project/c');

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/project/a'), p('/project/b'), p('/project/c')]);
        });

        it('should handle corrupt config file gracefully', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, 'not valid json!!!', 'utf-8');

            // Should not throw
            ensureFolderTrusted('/recovery/path');

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/recovery/path')]);
        });

        it('should handle config file with non-array trusted_folders gracefully', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: 'not-an-array'
            }), 'utf-8');

            ensureFolderTrusted('/new/path');

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/new/path')]);
        });

        it('should preserve all other config fields', () => {
            fs.mkdirSync(configDir, { recursive: true });
            const original = {
                last_logged_in_user: { host: 'https://github.com', login: 'test' },
                banner: 'never',
                trusted_folders: [p('/existing')],
                render_markdown: true,
                model: 'claude-opus-4.6',
                reasoning_effort: 'high',
            };
            fs.writeFileSync(configPath, JSON.stringify(original), 'utf-8');

            ensureFolderTrusted('/new/folder');

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.last_logged_in_user).toEqual(original.last_logged_in_user);
            expect(config.banner).toBe('never');
            expect(config.render_markdown).toBe(true);
            expect(config.model).toBe('claude-opus-4.6');
            expect(config.reasoning_effort).toBe('high');
            expect(config.trusted_folders).toEqual([p('/existing'), p('/new/folder')]);
        });
    });

    // ========================================================================
    // isFolderTrusted
    // ========================================================================

    describe('isFolderTrusted', () => {
        it('should return false when config file does not exist', () => {
            expect(isFolderTrusted('/nonexistent/path')).toBe(false);
        });

        it('should return false when folder is not in trusted_folders', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/other/path')]
            }), 'utf-8');

            expect(isFolderTrusted('/not/trusted')).toBe(false);
        });

        it('should return true when folder is in trusted_folders', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/my/project')]
            }), 'utf-8');

            expect(isFolderTrusted('/my/project')).toBe(true);
        });

        it('should match regardless of trailing slash', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/my/project')]
            }), 'utf-8');

            expect(isFolderTrusted('/my/project/')).toBe(true);
        });

        it('should return true after ensureFolderTrusted is called', () => {
            expect(isFolderTrusted('/dynamic/path')).toBe(false);

            ensureFolderTrusted('/dynamic/path');

            expect(isFolderTrusted('/dynamic/path')).toBe(true);
        });

        it('should return false when trusted_folders is not an array', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: 'broken'
            }), 'utf-8');

            expect(isFolderTrusted('/any/path')).toBe(false);
        });
    });
});
