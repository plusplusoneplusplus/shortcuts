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
    stripJsoncComments,
} from '@plusplusoneplusplus/coc-agent-sdk';

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

            ensureFolderTrusted(p('/some/project'));

            expect(fs.existsSync(configPath)).toBe(true);
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toContain(p('/some/project'));
        });

        it('should add folder to existing config with no trusted_folders', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({ model: 'gpt-5' }), 'utf-8');

            ensureFolderTrusted(p('/my/project'));

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

            ensureFolderTrusted(p('/new/path'));

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/existing/path'), p('/new/path')]);
        });

        it('should not duplicate an already-trusted folder', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/already/trusted')]
            }), 'utf-8');

            ensureFolderTrusted(p('/already/trusted'));

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/already/trusted')]);
        });

        it('should normalize trailing slashes when comparing', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/my/project')]
            }), 'utf-8');

            // Adding with trailing slash should detect as duplicate
            ensureFolderTrusted(p('/my/project/'));

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/my/project')]);
        });

        it('should handle multiple folders added sequentially', () => {
            ensureFolderTrusted(p('/project/a'));
            ensureFolderTrusted(p('/project/b'));
            ensureFolderTrusted(p('/project/c'));

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/project/a'), p('/project/b'), p('/project/c')]);
        });

        it('should preserve Linux-style WSL paths without resolving them as Windows paths', () => {
            ensureFolderTrusted('/home/tester/repo');

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toContain('/home/tester/repo');
        });

        it('should handle corrupt config file gracefully', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, 'not valid json!!!', 'utf-8');

            // Should not throw
            ensureFolderTrusted(p('/recovery/path'));

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(config.trusted_folders).toEqual([p('/recovery/path')]);
        });

        it('should handle config file with non-array trusted_folders gracefully', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: 'not-an-array'
            }), 'utf-8');

            ensureFolderTrusted(p('/new/path'));

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

            ensureFolderTrusted(p('/new/folder'));

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
            expect(isFolderTrusted(p('/nonexistent/path'))).toBe(false);
        });

        it('should return false when folder is not in trusted_folders', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/other/path')]
            }), 'utf-8');

            expect(isFolderTrusted(p('/not/trusted'))).toBe(false);
        });

        it('should return true when folder is in trusted_folders', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/my/project')]
            }), 'utf-8');

            expect(isFolderTrusted(p('/my/project'))).toBe(true);
        });

        it('should match regardless of trailing slash', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: [p('/my/project')]
            }), 'utf-8');

            expect(isFolderTrusted(p('/my/project/'))).toBe(true);
        });

        it('should match trusted WSL Linux paths exactly', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: ['/home/tester/repo']
            }), 'utf-8');

            expect(isFolderTrusted('/home/tester/repo')).toBe(true);
        });

        it('should return true after ensureFolderTrusted is called', () => {
            expect(isFolderTrusted(p('/dynamic/path'))).toBe(false);

            ensureFolderTrusted(p('/dynamic/path'));

            expect(isFolderTrusted(p('/dynamic/path'))).toBe(true);
        });

        it('should return false when trusted_folders is not an array', () => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify({
                trusted_folders: 'broken'
            }), 'utf-8');

            expect(isFolderTrusted(p('/any/path'))).toBe(false);
        });
    });

    // ========================================================================
    // stripJsoncComments
    // ========================================================================

    describe('stripJsoncComments', () => {
        it('should strip leading // comment lines', () => {
            const input = '// comment\n{"key": "value"}';
            expect(JSON.parse(stripJsoncComments(input))).toEqual({ key: 'value' });
        });

        it('should strip multiple comment lines', () => {
            const input = '// line 1\n// line 2\n{"a": 1}';
            expect(JSON.parse(stripJsoncComments(input))).toEqual({ a: 1 });
        });

        it('should handle indented comment lines', () => {
            const input = '  // indented comment\n{"a": 1}';
            expect(JSON.parse(stripJsoncComments(input))).toEqual({ a: 1 });
        });

        it('should not strip // inside JSON string values', () => {
            const input = '{"url": "https://github.com"}';
            expect(JSON.parse(stripJsoncComments(input))).toEqual({ url: 'https://github.com' });
        });

        it('should return input unchanged when there are no comments', () => {
            const input = '{"key": "value"}';
            expect(stripJsoncComments(input)).toBe(input);
        });

        it('should handle empty string', () => {
            expect(stripJsoncComments('')).toBe('');
        });

        it('should handle Copilot CLI v1.0.40+ real-world format', () => {
            const input = [
                '// User settings belong in settings.json.',
                '// This file is managed automatically.',
                '{',
                '  "trustedFolders": ["/home/user/repo"],',
                '  "copilotTokens": {"https://github.com:user": "gho_abc123"},',
                '  "loggedInUsers": [{"host": "https://github.com", "login": "user"}]',
                '}',
            ].join('\n');
            const parsed = JSON.parse(stripJsoncComments(input));
            expect(parsed.trustedFolders).toEqual(['/home/user/repo']);
            expect(parsed.copilotTokens).toEqual({ 'https://github.com:user': 'gho_abc123' });
            expect(parsed.loggedInUsers).toHaveLength(1);
        });
    });

    // ========================================================================
    // JSONC config file handling (auth data preservation)
    // ========================================================================

    describe('JSONC config file handling', () => {
        it('should preserve auth data when adding trusted folder to JSONC config', () => {
            fs.mkdirSync(configDir, { recursive: true });
            const jsoncContent = [
                '// User settings belong in settings.json.',
                '// This file is managed automatically.',
                '{',
                '  "trustedFolders": ["/home/user/repo"],',
                '  "copilotTokens": {"https://github.com:user": "gho_token"},',
                '  "loggedInUsers": [{"host": "https://github.com", "login": "user"}]',
                '}',
            ].join('\n');
            fs.writeFileSync(configPath, jsoncContent, 'utf-8');

            ensureFolderTrusted(p('/new/project'));

            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            // Auth fields must be preserved
            expect(config.copilotTokens).toEqual({ 'https://github.com:user': 'gho_token' });
            expect(config.loggedInUsers).toEqual([{ host: 'https://github.com', login: 'user' }]);
            expect(config.trustedFolders).toEqual(['/home/user/repo']);
            // New trusted folder added
            expect(config.trusted_folders).toContain(p('/new/project'));
        });

        it('should read trusted folders correctly from JSONC config via isFolderTrusted', () => {
            fs.mkdirSync(configDir, { recursive: true });
            const jsoncContent = [
                '// comment',
                '{',
                '  "trusted_folders": ["/home/user/repo"]',
                '}',
            ].join('\n');
            fs.writeFileSync(configPath, jsoncContent, 'utf-8');

            expect(isFolderTrusted('/home/user/repo')).toBe(true);
        });
    });
});
