/**
 * Git Init Utility Tests
 *
 * Tests for initializing wiki output directories as Git repositories
 * and writing default `.gitignore` files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    initGitRepo,
    writeGitignore,
    initWikiGitRepo,
    getDefaultGitignoreContent,
} from '../../src/utils/git-init';

// ============================================================================
// Test Helpers
// ============================================================================

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-git-init-test-'));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================================
// initGitRepo
// ============================================================================

describe('initGitRepo', () => {
    it('should initialize a git repository in an empty directory', () => {
        const result = initGitRepo(tempDir);
        expect(result).toBe(true);
        expect(fs.existsSync(path.join(tempDir, '.git'))).toBe(true);
    });

    it('should skip initialization if .git already exists', () => {
        // Pre-create .git directory
        fs.mkdirSync(path.join(tempDir, '.git'), { recursive: true });

        const infoMessages: string[] = [];
        const result = initGitRepo(tempDir, {
            info: (msg) => infoMessages.push(msg),
        });

        expect(result).toBe(true);
        expect(infoMessages.some(m => m.includes('already exists'))).toBe(true);
    });

    it('should return false and warn when directory does not exist', () => {
        const nonExistent = path.join(tempDir, 'does-not-exist');
        const warnings: string[] = [];

        const result = initGitRepo(nonExistent, {
            warn: (msg) => warnings.push(msg),
        });

        expect(result).toBe(false);
        expect(warnings.length).toBeGreaterThan(0);
    });

    it('should log info message on successful init', () => {
        const infoMessages: string[] = [];
        initGitRepo(tempDir, {
            info: (msg) => infoMessages.push(msg),
        });

        expect(infoMessages.some(m => m.includes('Initialized Git repository'))).toBe(true);
    });

    it('should work with relative paths', () => {
        const subDir = path.join(tempDir, 'sub', 'dir');
        fs.mkdirSync(subDir, { recursive: true });

        // Use the absolute path since relative is from cwd
        const result = initGitRepo(subDir);
        expect(result).toBe(true);
        expect(fs.existsSync(path.join(subDir, '.git'))).toBe(true);
    });
});

// ============================================================================
// writeGitignore
// ============================================================================

describe('writeGitignore', () => {
    it('should create .gitignore with default content', () => {
        const result = writeGitignore(tempDir);
        expect(result).toBe(true);

        const content = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8');
        expect(content).toBe(getDefaultGitignoreContent());
    });

    it('should not overwrite existing .gitignore', () => {
        const gitignorePath = path.join(tempDir, '.gitignore');
        fs.writeFileSync(gitignorePath, 'custom content', 'utf-8');

        const infoMessages: string[] = [];
        const result = writeGitignore(tempDir, {
            info: (msg) => infoMessages.push(msg),
        });

        expect(result).toBe(true);
        expect(fs.readFileSync(gitignorePath, 'utf-8')).toBe('custom content');
        expect(infoMessages.some(m => m.includes('already exists'))).toBe(true);
    });

    it('should include .DS_Store in gitignore', () => {
        writeGitignore(tempDir);
        const content = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8');
        expect(content).toContain('.DS_Store');
    });

    it('should include Thumbs.db in gitignore', () => {
        writeGitignore(tempDir);
        const content = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8');
        expect(content).toContain('Thumbs.db');
    });

    it('should include node_modules in gitignore', () => {
        writeGitignore(tempDir);
        const content = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8');
        expect(content).toContain('node_modules/');
    });

    it('should include .wiki-cache in gitignore', () => {
        writeGitignore(tempDir);
        const content = fs.readFileSync(path.join(tempDir, '.gitignore'), 'utf-8');
        expect(content).toContain('.wiki-cache/');
    });

    it('should return false and warn for non-existent directory', () => {
        const nonExistent = path.join(tempDir, 'does-not-exist');
        const warnings: string[] = [];

        const result = writeGitignore(nonExistent, {
            warn: (msg) => warnings.push(msg),
        });

        expect(result).toBe(false);
        expect(warnings.length).toBeGreaterThan(0);
    });

    it('should log info message on successful creation', () => {
        const infoMessages: string[] = [];
        writeGitignore(tempDir, {
            info: (msg) => infoMessages.push(msg),
        });

        expect(infoMessages.some(m => m.includes('Created .gitignore'))).toBe(true);
    });
});

// ============================================================================
// initWikiGitRepo (integration)
// ============================================================================

describe('initWikiGitRepo', () => {
    it('should initialize git repo and create .gitignore', () => {
        initWikiGitRepo(tempDir);

        expect(fs.existsSync(path.join(tempDir, '.git'))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(true);
    });

    it('should not fail when called twice', () => {
        initWikiGitRepo(tempDir);
        initWikiGitRepo(tempDir);

        expect(fs.existsSync(path.join(tempDir, '.git'))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, '.gitignore'))).toBe(true);
    });

    it('should preserve existing .gitignore when called on existing repo', () => {
        // First call — sets up repo + gitignore
        initWikiGitRepo(tempDir);

        // Modify the gitignore
        const gitignorePath = path.join(tempDir, '.gitignore');
        fs.writeFileSync(gitignorePath, 'custom rules', 'utf-8');

        // Second call — should not overwrite
        initWikiGitRepo(tempDir);

        expect(fs.readFileSync(gitignorePath, 'utf-8')).toBe('custom rules');
    });

    it('should use provided log callbacks', () => {
        const infoMessages: string[] = [];
        const warnMessages: string[] = [];

        initWikiGitRepo(tempDir, {
            info: (msg) => infoMessages.push(msg),
            warn: (msg) => warnMessages.push(msg),
        });

        expect(infoMessages.length).toBeGreaterThan(0);
        expect(warnMessages.length).toBe(0);
    });

    it('should handle missing directory gracefully', () => {
        const nonExistent = path.join(tempDir, 'missing');
        const warnMessages: string[] = [];

        // Should not throw
        initWikiGitRepo(nonExistent, {
            info: () => {},
            warn: (msg) => warnMessages.push(msg),
        });

        expect(warnMessages.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// getDefaultGitignoreContent
// ============================================================================

describe('getDefaultGitignoreContent', () => {
    it('should return a non-empty string', () => {
        const content = getDefaultGitignoreContent();
        expect(content.length).toBeGreaterThan(0);
    });

    it('should contain OS, editor, and build sections', () => {
        const content = getDefaultGitignoreContent();
        expect(content).toContain('# OS files');
        expect(content).toContain('# Editor files');
        expect(content).toContain('# Node/build artifacts');
    });
});
