/**
 * Tests for skill-scanner GitHub scanning logic.
 * Mocks execAsync / httpGetJson to simulate GitHub API responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// Mock external dependencies before importing scanner
vi.mock('../../src/utils', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../src/utils')>();
    return {
        ...original,
        execAsync: vi.fn(),
        httpGetJson: vi.fn(),
        safeExists: vi.fn().mockReturnValue(false),
    };
});

import { scanForSkills, _resetGhCliCache } from '../../src/skills/skill-scanner';
import type { ParsedSource } from '../../src/skills/types';
import { execAsync, httpGetJson, safeExists } from '../../src/utils';

const mockedExecAsync = vi.mocked(execAsync);
const mockedHttpGetJson = vi.mocked(httpGetJson);
const mockedSafeExists = vi.mocked(safeExists);

const INSTALL_PATH = '/tmp/skills-install';

function makeGitHubSource(overrides: Partial<NonNullable<ParsedSource['github']>> = {}): ParsedSource {
    return {
        type: 'github',
        github: {
            owner: 'blader',
            repo: 'humanizer',
            branch: 'main',
            path: '',
            ...overrides,
        },
    };
}

/** Helper: JSON response from gh CLI as stdout */
function ghStdout(data: any): { stdout: string } {
    return { stdout: JSON.stringify(data) };
}

describe('scanForSkills – GitHub with gh CLI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetGhCliCache();
        // Ensure gh CLI is "available"
        mockedExecAsync.mockImplementation(async (cmd: string) => {
            if (cmd === 'gh --version') {
                return { stdout: 'gh version 2.0.0', stderr: '' };
            }
            throw new Error(`Unexpected command: ${cmd}`);
        });
    });

    it('detects SKILL.md at repo root (no subdirectories)', async () => {
        const rootListing = [
            { name: 'README.md', type: 'file' },
            { name: 'SKILL.md', type: 'file' },
            { name: 'WARP.md', type: 'file' },
        ];
        const skillContent = {
            name: 'SKILL.md',
            content: Buffer.from('# Humanizer\nMake text more human-like').toString('base64'),
        };

        mockedExecAsync.mockImplementation(async (cmd: string) => {
            if (cmd === 'gh --version') {
                return { stdout: 'gh version 2.0.0', stderr: '' };
            }
            if (cmd.includes('/contents/?ref=main')) {
                return ghStdout(rootListing);
            }
            if (cmd.includes('/contents//SKILL.md?ref=main')) {
                return ghStdout(skillContent);
            }
            throw new Error(`Unexpected command: ${cmd}`);
        });

        const result = await scanForSkills(makeGitHubSource(), INSTALL_PATH);

        expect(result.success).toBe(true);
        expect(result.skills).toHaveLength(1);
        expect(result.skills[0].name).toBe('humanizer');
        expect(result.skills[0].description).toBe('Make text more human-like');
        expect(result.skills[0].path).toBe('');
    });

    it('detects SKILL.md at a non-root path', async () => {
        const listing = [
            { name: 'SKILL.md', type: 'file' },
            { name: 'prompt.md', type: 'file' },
        ];
        const skillContent = {
            name: 'SKILL.md',
            content: Buffer.from('# My Skill\nA great skill').toString('base64'),
        };

        mockedExecAsync.mockImplementation(async (cmd: string) => {
            if (cmd === 'gh --version') {
                return { stdout: 'gh version 2.0.0', stderr: '' };
            }
            if (cmd.includes('/contents/skills/my-skill?ref=main')) {
                return ghStdout(listing);
            }
            if (cmd.includes('/contents/skills/my-skill/SKILL.md?ref=main')) {
                return ghStdout(skillContent);
            }
            throw new Error(`Unexpected command: ${cmd}`);
        });

        const result = await scanForSkills(
            makeGitHubSource({ path: 'skills/my-skill' }),
            INSTALL_PATH,
        );

        expect(result.success).toBe(true);
        expect(result.skills).toHaveLength(1);
        expect(result.skills[0].name).toBe('my-skill');
    });

    it('still discovers skills in subdirectories', async () => {
        const rootListing = [
            { name: 'skill-a', type: 'dir' },
            { name: 'skill-b', type: 'dir' },
            { name: 'README.md', type: 'file' },
        ];
        const skillFileResponse = (name: string) => ({
            name: 'SKILL.md',
            content: Buffer.from(`# ${name}`).toString('base64'),
        });

        mockedExecAsync.mockImplementation(async (cmd: string) => {
            if (cmd === 'gh --version') {
                return { stdout: 'gh version 2.0.0', stderr: '' };
            }
            if (cmd.includes('/contents/?ref=main') || cmd.includes('/contents?ref=main')) {
                return ghStdout(rootListing);
            }
            if (cmd.includes('/contents/skill-a/SKILL.md')) {
                return ghStdout(skillFileResponse('Skill A'));
            }
            if (cmd.includes('/contents/skill-b/SKILL.md')) {
                return ghStdout(skillFileResponse('Skill B'));
            }
            throw new Error(`Unexpected command: ${cmd}`);
        });

        const result = await scanForSkills(makeGitHubSource(), INSTALL_PATH);

        expect(result.success).toBe(true);
        expect(result.skills).toHaveLength(2);
        const names = result.skills.map(s => s.name).sort();
        expect(names).toEqual(['skill-a', 'skill-b']);
    });

    it('returns error when no skills found', async () => {
        const rootListing = [
            { name: 'README.md', type: 'file' },
            { name: 'src', type: 'dir' },
        ];

        mockedExecAsync.mockImplementation(async (cmd: string) => {
            if (cmd === 'gh --version') {
                return { stdout: 'gh version 2.0.0', stderr: '' };
            }
            if (cmd.includes('/contents/?ref=main') || cmd.includes('/contents?ref=main')) {
                return ghStdout(rootListing);
            }
            // src dir doesn't contain SKILL.md
            throw new Error('Not found');
        });

        const result = await scanForSkills(makeGitHubSource(), INSTALL_PATH);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No valid skills found');
    });

    it('marks skill as alreadyExists when install path contains it', async () => {
        const rootListing = [
            { name: 'SKILL.md', type: 'file' },
        ];
        const skillContent = {
            name: 'SKILL.md',
            content: Buffer.from('# Humanizer').toString('base64'),
        };

        mockedSafeExists.mockImplementation((p: string) => {
            return p === path.join(INSTALL_PATH, 'humanizer');
        });

        mockedExecAsync.mockImplementation(async (cmd: string) => {
            if (cmd === 'gh --version') {
                return { stdout: 'gh version 2.0.0', stderr: '' };
            }
            if (cmd.includes('/contents/?ref=main')) {
                return ghStdout(rootListing);
            }
            if (cmd.includes('/SKILL.md?ref=main')) {
                return ghStdout(skillContent);
            }
            throw new Error(`Unexpected command: ${cmd}`);
        });

        const result = await scanForSkills(makeGitHubSource(), INSTALL_PATH);

        expect(result.success).toBe(true);
        expect(result.skills[0].alreadyExists).toBe(true);
    });
});

describe('scanForSkills – GitHub with HTTP', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetGhCliCache();
        // gh CLI is NOT available → falls back to HTTP
        mockedExecAsync.mockImplementation(async (cmd: string) => {
            if (cmd === 'gh --version') {
                throw new Error('not found');
            }
            throw new Error(`Unexpected command: ${cmd}`);
        });
    });

    it('detects SKILL.md at repo root (no subdirectories)', async () => {
        const rootListing = [
            { name: 'README.md', type: 'file' },
            { name: 'SKILL.md', type: 'file' },
        ];
        const skillContent = {
            name: 'SKILL.md',
            content: Buffer.from('# Humanizer\nMake text more human-like').toString('base64'),
        };

        mockedHttpGetJson.mockImplementation(async (url: string) => {
            if (url.includes('/contents/?ref=main')) {
                return rootListing;
            }
            if (url.includes('/contents//SKILL.md?ref=main')) {
                return skillContent;
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const result = await scanForSkills(makeGitHubSource(), INSTALL_PATH);

        expect(result.success).toBe(true);
        expect(result.skills).toHaveLength(1);
        expect(result.skills[0].name).toBe('humanizer');
        expect(result.skills[0].description).toBe('Make text more human-like');
    });

    it('still discovers skills in subdirectories via HTTP', async () => {
        const rootListing = [
            { name: 'skill-a', type: 'dir' },
            { name: 'README.md', type: 'file' },
        ];
        const skillFileResponse = {
            name: 'SKILL.md',
            content: Buffer.from('# Skill A\nFirst skill').toString('base64'),
        };

        mockedHttpGetJson.mockImplementation(async (url: string) => {
            if (url.includes('/contents/?ref=main') || url.includes('/contents?ref=main')) {
                return rootListing;
            }
            if (url.includes('/contents/skill-a/SKILL.md')) {
                return skillFileResponse;
            }
            throw new Error(`Unexpected URL: ${url}`);
        });

        const result = await scanForSkills(makeGitHubSource(), INSTALL_PATH);

        expect(result.success).toBe(true);
        expect(result.skills).toHaveLength(1);
        expect(result.skills[0].name).toBe('skill-a');
    });

    it('returns error when no skills found via HTTP', async () => {
        const rootListing = [
            { name: 'README.md', type: 'file' },
        ];

        mockedHttpGetJson.mockImplementation(async (url: string) => {
            if (url.includes('/contents/?ref=main') || url.includes('/contents?ref=main')) {
                return rootListing;
            }
            throw new Error('Not found');
        });

        const result = await scanForSkills(makeGitHubSource(), INSTALL_PATH);

        expect(result.success).toBe(false);
        expect(result.error).toContain('No valid skills found');
    });
});
