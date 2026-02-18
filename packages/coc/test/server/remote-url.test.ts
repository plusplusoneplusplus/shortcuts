/**
 * Remote URL utility tests
 *
 * Tests for normalizeRemoteUrl and detectRemoteUrl helper functions
 * used by the workspace registration and clone grouping features.
 */

import { describe, it, expect } from 'vitest';
import { normalizeRemoteUrl, detectRemoteUrl } from '@plusplusoneplusplus/coc-server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';

// ============================================================================
// normalizeRemoteUrl
// ============================================================================

describe('normalizeRemoteUrl', () => {
    describe('HTTPS URLs', () => {
        it('should normalize standard HTTPS URL', () => {
            expect(normalizeRemoteUrl('https://github.com/user/repo.git'))
                .toBe('github.com/user/repo');
        });

        it('should strip trailing .git suffix', () => {
            expect(normalizeRemoteUrl('https://github.com/user/repo.git'))
                .toBe('github.com/user/repo');
        });

        it('should handle URL without .git suffix', () => {
            expect(normalizeRemoteUrl('https://github.com/user/repo'))
                .toBe('github.com/user/repo');
        });

        it('should strip trailing slash', () => {
            expect(normalizeRemoteUrl('https://github.com/user/repo/'))
                .toBe('github.com/user/repo');
        });

        it('should strip trailing .git/ (slash after .git)', () => {
            expect(normalizeRemoteUrl('https://github.com/user/repo.git/'))
                .toBe('github.com/user/repo');
        });

        it('should handle HTTP protocol', () => {
            expect(normalizeRemoteUrl('http://github.com/user/repo.git'))
                .toBe('github.com/user/repo');
        });
    });

    describe('SSH URLs', () => {
        it('should normalize SSH shorthand (git@host:user/repo.git)', () => {
            expect(normalizeRemoteUrl('git@github.com:user/repo.git'))
                .toBe('github.com/user/repo');
        });

        it('should normalize SSH shorthand without .git suffix', () => {
            expect(normalizeRemoteUrl('git@github.com:user/repo'))
                .toBe('github.com/user/repo');
        });

        it('should normalize ssh:// protocol URL', () => {
            expect(normalizeRemoteUrl('ssh://git@github.com/user/repo.git'))
                .toBe('github.com/user/repo');
        });

        it('should normalize ssh:// protocol without .git suffix', () => {
            expect(normalizeRemoteUrl('ssh://git@github.com/user/repo'))
                .toBe('github.com/user/repo');
        });
    });

    describe('Git protocol URLs', () => {
        it('should normalize git:// protocol URL', () => {
            expect(normalizeRemoteUrl('git://github.com/user/repo.git'))
                .toBe('github.com/user/repo');
        });

        it('should normalize git:// protocol without .git', () => {
            expect(normalizeRemoteUrl('git://github.com/user/repo'))
                .toBe('github.com/user/repo');
        });

        it('should normalize git:// with trailing slash', () => {
            expect(normalizeRemoteUrl('git://github.com/user/repo.git/'))
                .toBe('github.com/user/repo');
        });
    });

    describe('Cross-format equivalence', () => {
        it('should produce same result for HTTPS and SSH URLs to same repo', () => {
            const https = normalizeRemoteUrl('https://github.com/user/repo.git');
            const ssh = normalizeRemoteUrl('git@github.com:user/repo.git');
            expect(https).toBe(ssh);
        });

        it('should produce same result for HTTPS and ssh:// URLs', () => {
            const https = normalizeRemoteUrl('https://github.com/user/repo.git');
            const sshProto = normalizeRemoteUrl('ssh://git@github.com/user/repo.git');
            expect(https).toBe(sshProto);
        });

        it('should produce same result for git:// and HTTPS URLs', () => {
            const git = normalizeRemoteUrl('git://github.com/user/repo.git');
            const https = normalizeRemoteUrl('https://github.com/user/repo.git');
            expect(git).toBe(https);
        });

        it('should handle various trailing formats consistently', () => {
            const urls = [
                'https://github.com/user/repo.git',
                'https://github.com/user/repo.git/',
                'https://github.com/user/repo',
                'https://github.com/user/repo/',
                'git@github.com:user/repo.git',
                'git@github.com:user/repo',
                'ssh://git@github.com/user/repo.git',
            ];
            const results = urls.map(normalizeRemoteUrl);
            const unique = new Set(results);
            expect(unique.size).toBe(1);
            expect(results[0]).toBe('github.com/user/repo');
        });
    });

    describe('Enterprise / private hosts', () => {
        it('should normalize GitHub Enterprise HTTPS URLs', () => {
            expect(normalizeRemoteUrl('https://git.company.com/team/project.git'))
                .toBe('git.company.com/team/project');
        });

        it('should normalize GitHub Enterprise SSH URLs', () => {
            expect(normalizeRemoteUrl('git@git.company.com:team/project.git'))
                .toBe('git.company.com/team/project');
        });

        it('should normalize GitLab URLs', () => {
            expect(normalizeRemoteUrl('https://gitlab.com/group/subgroup/repo.git'))
                .toBe('gitlab.com/group/subgroup/repo');
        });

        it('should normalize Bitbucket URLs', () => {
            expect(normalizeRemoteUrl('git@bitbucket.org:team/repo.git'))
                .toBe('bitbucket.org/team/repo');
        });
    });

    describe('Edge cases', () => {
        it('should handle whitespace', () => {
            expect(normalizeRemoteUrl('  https://github.com/user/repo.git  '))
                .toBe('github.com/user/repo');
        });

        it('should handle URL with port in ssh:// form', () => {
            expect(normalizeRemoteUrl('ssh://git@github.com:22/user/repo.git'))
                .toBe('github.com:22/user/repo');
        });

        it('should handle deeply nested repo paths', () => {
            expect(normalizeRemoteUrl('https://github.com/org/team/sub/repo.git'))
                .toBe('github.com/org/team/sub/repo');
        });
    });
});

// ============================================================================
// detectRemoteUrl
// ============================================================================

describe('detectRemoteUrl', () => {
    it('should detect remote URL for the project root (which is a git repo)', () => {
        const repoPath = path.resolve(__dirname, '..', '..', '..', '..');
        const url = detectRemoteUrl(repoPath);
        expect(url).toBeDefined();
        expect(typeof url).toBe('string');
        expect(url!.length).toBeGreaterThan(0);
    });

    it('should return undefined for non-git directories', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
        try {
            const url = detectRemoteUrl(tmpDir);
            expect(url).toBeUndefined();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should return undefined for a git repo with no remotes', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-git-'));
        try {
            childProcess.execSync('git init', { cwd: tmpDir, encoding: 'utf-8' });
            const url = detectRemoteUrl(tmpDir);
            expect(url).toBeUndefined();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should detect URL from non-origin remote if origin is missing', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-remote-'));
        try {
            childProcess.execSync('git init', { cwd: tmpDir, encoding: 'utf-8' });
            childProcess.execSync(
                'git remote add upstream https://github.com/test/upstream-repo.git',
                { cwd: tmpDir, encoding: 'utf-8' }
            );
            const url = detectRemoteUrl(tmpDir);
            expect(url).toBe('https://github.com/test/upstream-repo.git');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should prefer origin remote when both origin and others exist', () => {
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
            const url = detectRemoteUrl(tmpDir);
            expect(url).toBe('https://github.com/test/origin-repo.git');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
