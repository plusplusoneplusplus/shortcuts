/**
 * Tests for skill-installer GitHub source logic.
 * Verifies HTTP-first install with gh CLI fallback behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Mock utils before importing installer
vi.mock('../../src/utils', async (importOriginal) => {
    const original = await importOriginal<typeof import('../../src/utils')>();
    return {
        ...original,
        execAsync: vi.fn(),
        httpGetJson: vi.fn(),
        httpDownload: vi.fn(),
    };
});

import { installSkills } from '../../src/skills/skill-installer';
import type { DiscoveredSkill, ParsedSource } from '../../src/skills/types';
import { execAsync, httpGetJson, httpDownload } from '../../src/utils';

const mockedExecAsync = vi.mocked(execAsync);
const mockedHttpGetJson = vi.mocked(httpGetJson);
const mockedHttpDownload = vi.mocked(httpDownload);

const GITHUB_SOURCE: ParsedSource = {
    type: 'github',
    github: { owner: 'owner', repo: 'repo', branch: 'main' },
};

const SKILL: DiscoveredSkill = {
    name: 'skill-a',
    description: 'Test skill',
    path: '.github/skills/skill-a',
    alreadyExists: false,
};

const FILE_LISTING = [
    { name: 'SKILL.md', type: 'file', download_url: 'https://raw.example.com/SKILL.md' },
];

describe('installSkills (GitHub source)', () => {
    let installDir: string;

    beforeEach(() => {
        installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-dst-'));
        vi.resetAllMocks();
    });

    afterEach(() => {
        fs.rmSync(installDir, { recursive: true, force: true });
    });

    it('uses HTTP when it succeeds (does not call gh)', async () => {
        mockedHttpGetJson.mockResolvedValue(FILE_LISTING);
        mockedHttpDownload.mockResolvedValue('# Skill A');

        const result = await installSkills([SKILL], GITHUB_SOURCE, installDir, async () => false);

        expect(result.installed).toBe(1);
        expect(result.failed).toBe(0);
        // gh CLI (execAsync for api) should NOT have been called
        const ghApiCalls = mockedExecAsync.mock.calls.filter(([cmd]) => String(cmd).startsWith('gh api'));
        expect(ghApiCalls).toHaveLength(0);
    });

    it('falls back to gh CLI when HTTP fails and gh is available', async () => {
        // HTTP fails
        mockedHttpGetJson.mockRejectedValue(new Error('HTTP 404'));
        // gh --version succeeds (gh is available)
        mockedExecAsync.mockImplementation(async (cmd: string) => {
            if (cmd === 'gh --version') return { stdout: 'gh version 2.0.0', stderr: '' };
            // gh api call returns valid listing
            if (cmd.startsWith('gh api')) return { stdout: JSON.stringify(FILE_LISTING), stderr: '' };
            throw new Error(`Unexpected command: ${cmd}`);
        });
        mockedHttpDownload.mockResolvedValue('# Skill A');

        const result = await installSkills([SKILL], GITHUB_SOURCE, installDir, async () => false);

        expect(result.installed).toBe(1);
        expect(result.failed).toBe(0);
        const ghApiCalls = mockedExecAsync.mock.calls.filter(([cmd]) => String(cmd).startsWith('gh api'));
        expect(ghApiCalls.length).toBeGreaterThan(0);
    });

    it('propagates HTTP error when gh CLI is not available', async () => {
        mockedHttpGetJson.mockRejectedValue(new Error('HTTP 404'));
        // gh --version fails (not installed)
        mockedExecAsync.mockRejectedValue(new Error('gh: command not found'));

        const result = await installSkills([SKILL], GITHUB_SOURCE, installDir, async () => false);

        expect(result.failed).toBe(1);
        expect(result.details[0].reason).toContain('HTTP 404');
    });

    it('does not call gh CLI when HTTP succeeds even if gh is installed', async () => {
        mockedHttpGetJson.mockResolvedValue(FILE_LISTING);
        mockedHttpDownload.mockResolvedValue('# Skill A');
        // If gh were called it would succeed — but it should not be called at all
        mockedExecAsync.mockResolvedValue({ stdout: 'gh version 2.0.0', stderr: '' });

        const result = await installSkills([SKILL], GITHUB_SOURCE, installDir, async () => false);

        expect(result.installed).toBe(1);
        // execAsync should not have been invoked at all (no gh --version, no gh api)
        expect(mockedExecAsync).not.toHaveBeenCalled();
    });
});
