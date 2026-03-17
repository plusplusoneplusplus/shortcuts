/**
 * Tests for source-detector skill logic.
 */

import { describe, it, expect } from 'vitest';
import { detectSource, SourceDetectionErrors } from '../../src/skills/source-detector';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('detectSource', () => {
    it('returns error for empty input', () => {
        const result = detectSource('');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBe(SourceDetectionErrors.AMBIGUOUS);
        }
    });

    it('parses a full GitHub URL with tree/branch/path', () => {
        const result = detectSource('https://github.com/owner/repo/tree/main/skills');
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.source.type).toBe('github');
            expect(result.source.github?.owner).toBe('owner');
            expect(result.source.github?.repo).toBe('repo');
            expect(result.source.github?.branch).toBe('main');
            expect(result.source.github?.path).toBe('skills');
        }
    });

    it('parses a GitHub URL with just owner/repo', () => {
        const result = detectSource('https://github.com/owner/repo');
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.source.type).toBe('github');
            expect(result.source.github?.owner).toBe('owner');
            expect(result.source.github?.repo).toBe('repo');
            expect(result.source.github?.branch).toBe('main');
            expect(result.source.github?.path).toBe('');
        }
    });

    it('parses github.com URL without protocol', () => {
        const result = detectSource('github.com/owner/repo');
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.source.type).toBe('github');
            expect(result.source.github?.owner).toBe('owner');
        }
    });

    it('returns error for invalid GitHub URL (only one segment)', () => {
        const result = detectSource('https://github.com/onlyone');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBe(SourceDetectionErrors.INVALID_GITHUB_URL);
        }
    });

    it('returns error for path not found', () => {
        const result = detectSource('/nonexistent/path/to/skills');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toContain('Path not found');
        }
    });

    it('resolves a valid local absolute path', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
        try {
            const result = detectSource(tmpDir);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.source.type).toBe('local');
                expect(result.source.localPath).toBe(path.normalize(tmpDir));
            }
        } finally {
            fs.rmdirSync(tmpDir);
        }
    });

    it('resolves a valid relative path when workspaceRoot provided', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
        const subDir = path.join(tmpDir, 'myskills');
        fs.mkdirSync(subDir);
        try {
            const result = detectSource('./myskills', tmpDir);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.source.type).toBe('local');
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('returns AMBIGUOUS error for unrecognized input', () => {
        const result = detectSource('not-a-url-or-path');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBe(SourceDetectionErrors.AMBIGUOUS);
        }
    });
});
