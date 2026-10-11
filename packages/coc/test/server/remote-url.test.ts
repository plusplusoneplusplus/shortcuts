/**
 * Integration tests for detectRemoteUrl (re-exported on @plusplusoneplusplus/coc-server).
 *
 * normalizeRemoteUrl formatting is covered in normalize-remote-url.test.ts and
 * packages/coc/test/spa/react/repos/repoGrouping.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { detectRemoteUrl } from '@plusplusoneplusplus/coc-server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';

// ============================================================================
// detectRemoteUrl
// ============================================================================

describe('detectRemoteUrl', () => {
    it('should detect remote URL for the project root (which is a git repo)', async () => {
        const repoPath = path.resolve(__dirname, '..', '..', '..', '..');
        const url = await detectRemoteUrl(repoPath);
        expect(url).toBeDefined();
        expect(typeof url).toBe('string');
        expect(url!.length).toBeGreaterThan(0);
    });

    it('should return undefined for non-git directories', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
        try {
            const url = await detectRemoteUrl(tmpDir);
            expect(url).toBeUndefined();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should return undefined for a git repo with no remotes', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-git-'));
        try {
            childProcess.execSync('git init', { cwd: tmpDir, encoding: 'utf-8' });
            const url = await detectRemoteUrl(tmpDir);
            expect(url).toBeUndefined();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should detect URL from non-origin remote if origin is missing', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-remote-'));
        try {
            childProcess.execSync('git init', { cwd: tmpDir, encoding: 'utf-8' });
            childProcess.execSync(
                'git remote add upstream https://github.com/test/upstream-repo.git',
                { cwd: tmpDir, encoding: 'utf-8' }
            );
            const url = await detectRemoteUrl(tmpDir);
            expect(url).toBe('https://github.com/test/upstream-repo.git');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should prefer origin remote when both origin and others exist', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-remote-'));
        try {
            childProcess.execSync('git init', { cwd: tmpDir, encoding: 'utf-8' });
            childProcess.execSync(
                'git remote add origin https://github.com/test/origin-repo.git',
                { cwd: tmpDir, encoding: 'utf-8' }
            );
            childProcess.execSync(
                'git remote add upstream https://github.com/test/upstream-repo.git',
                { cwd: tmpDir, encoding: 'utf-8' }
            );
            const url = await detectRemoteUrl(tmpDir);
            expect(url).toBe('https://github.com/test/origin-repo.git');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
