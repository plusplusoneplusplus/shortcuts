/**
 * Tests for source-detector skill logic.
 */

import { describe, it, expect } from 'vitest';
import { detectSource, SourceDetectionErrors, isClawHubUrl, parseClawHubUrl, resolveClawHubToGitHub } from '../../src/skills/source-detector';
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

describe('isClawHubUrl', () => {
    it('matches https://clawhub.ai/owner/slug', () => {
        expect(isClawHubUrl('https://clawhub.ai/pskoett/self-improving-agent')).toBe(true);
    });

    it('matches http://clawhub.ai/owner/slug', () => {
        expect(isClawHubUrl('http://clawhub.ai/pskoett/self-improving-agent')).toBe(true);
    });

    it('matches clawhub.ai/owner/slug without protocol', () => {
        expect(isClawHubUrl('clawhub.ai/pskoett/self-improving-agent')).toBe(true);
    });

    it('does not match github.com URLs', () => {
        expect(isClawHubUrl('https://github.com/user/repo')).toBe(false);
    });

    it('does not match arbitrary strings', () => {
        expect(isClawHubUrl('some-random-text')).toBe(false);
    });
});

describe('parseClawHubUrl', () => {
    it('parses https://clawhub.ai/owner/slug', () => {
        expect(parseClawHubUrl('https://clawhub.ai/pskoett/self-improving-agent')).toEqual({
            owner: 'pskoett',
            slug: 'self-improving-agent',
        });
    });

    it('parses clawhub.ai/owner/slug without protocol', () => {
        expect(parseClawHubUrl('clawhub.ai/owner/my-skill')).toEqual({
            owner: 'owner',
            slug: 'my-skill',
        });
    });

    it('handles trailing slash', () => {
        expect(parseClawHubUrl('clawhub.ai/owner/slug/')).toEqual({
            owner: 'owner',
            slug: 'slug',
        });
    });

    it('returns null for URL with only owner (no slug)', () => {
        expect(parseClawHubUrl('clawhub.ai/onlyone')).toBeNull();
    });

    it('returns null for empty path', () => {
        expect(parseClawHubUrl('clawhub.ai/')).toBeNull();
    });
});

describe('detectSource with ClawHub URLs', () => {
    it('detects clawhub.ai URL as clawhub type', () => {
        const result = detectSource('clawhub.ai/pskoett/self-improving-agent');
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.source.type).toBe('clawhub');
            expect(result.source.clawhub).toEqual({ owner: 'pskoett', slug: 'self-improving-agent' });
        }
    });

    it('detects https://clawhub.ai URL as clawhub type', () => {
        const result = detectSource('https://clawhub.ai/owner/skill');
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.source.type).toBe('clawhub');
        }
    });

    it('returns error for invalid ClawHub URL (missing slug)', () => {
        const result = detectSource('clawhub.ai/onlyone');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBe(SourceDetectionErrors.INVALID_CLAWHUB_URL);
        }
    });
});

describe('resolveClawHubToGitHub', () => {
    it('extracts GitHub URL from page HTML', async () => {
        const fakeHtml = `
            <html><body>
            <h1>Self Improving Agent</h1>
            <p>Install with: git clone https://github.com/peterskoett/self-improving-agent</p>
            </body></html>
        `;
        const result = await resolveClawHubToGitHub(
            { type: 'clawhub', clawhub: { owner: 'pskoett', slug: 'self-improving-agent' } },
            async () => fakeHtml
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.source.type).toBe('github');
            expect(result.source.github?.owner).toBe('peterskoett');
            expect(result.source.github?.repo).toBe('self-improving-agent');
            expect(result.source.github?.branch).toBe('main');
        }
    });

    it('prefers repo name matching the skill slug', async () => {
        const fakeHtml = `
            <html><body>
            <p>See https://github.com/alice/other-project for more</p>
            <p>Clone: https://github.com/bob/my-skill</p>
            </body></html>
        `;
        const result = await resolveClawHubToGitHub(
            { type: 'clawhub', clawhub: { owner: 'someone', slug: 'my-skill' } },
            async () => fakeHtml
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.source.github?.owner).toBe('bob');
            expect(result.source.github?.repo).toBe('my-skill');
        }
    });

    it('falls back to first GitHub URL when slug does not match', async () => {
        const fakeHtml = `
            <html><body>
            <p>Source: https://github.com/alice/cool-tool</p>
            <p>Also: https://github.com/bob/other</p>
            </body></html>
        `;
        const result = await resolveClawHubToGitHub(
            { type: 'clawhub', clawhub: { owner: 'someone', slug: 'unrelated-name' } },
            async () => fakeHtml
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.source.github?.owner).toBe('alice');
            expect(result.source.github?.repo).toBe('cool-tool');
        }
    });

    it('excludes openclaw/clawhub footer link', async () => {
        const fakeHtml = `
            <html><body>
            <p>Powered by <a href="https://github.com/openclaw/clawhub">ClawHub</a></p>
            <p>Source: https://github.com/realowner/real-skill</p>
            </body></html>
        `;
        const result = await resolveClawHubToGitHub(
            { type: 'clawhub', clawhub: { owner: 'someone', slug: 'real-skill' } },
            async () => fakeHtml
        );
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.source.github?.owner).toBe('realowner');
            expect(result.source.github?.repo).toBe('real-skill');
        }
    });

    it('returns error when no GitHub URL found in page', async () => {
        const fakeHtml = `<html><body><p>No links here</p></body></html>`;
        const result = await resolveClawHubToGitHub(
            { type: 'clawhub', clawhub: { owner: 'someone', slug: 'skill' } },
            async () => fakeHtml
        );
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBe(SourceDetectionErrors.CLAWHUB_NO_GITHUB_URL);
        }
    });

    it('returns error when only openclaw/clawhub footer URL exists', async () => {
        const fakeHtml = `
            <html><body>
            <footer><a href="https://github.com/openclaw/clawhub">ClawHub</a></footer>
            </body></html>
        `;
        const result = await resolveClawHubToGitHub(
            { type: 'clawhub', clawhub: { owner: 'someone', slug: 'skill' } },
            async () => fakeHtml
        );
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBe(SourceDetectionErrors.CLAWHUB_NO_GITHUB_URL);
        }
    });

    it('returns error when fetch fails', async () => {
        const result = await resolveClawHubToGitHub(
            { type: 'clawhub', clawhub: { owner: 'someone', slug: 'skill' } },
            async () => { throw new Error('Network error'); }
        );
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toContain('Failed to fetch ClawHub page');
        }
    });

    it('returns error when clawhub field is missing', async () => {
        const result = await resolveClawHubToGitHub({ type: 'clawhub' });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error).toBe(SourceDetectionErrors.INVALID_CLAWHUB_URL);
        }
    });
});
