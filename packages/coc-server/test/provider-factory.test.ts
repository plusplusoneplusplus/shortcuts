/**
 * Tests for ProviderFactory — detectProviderType, parseGitHubRemote,
 * parseAdoRemote, and createPullRequestsService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderFactory, ProviderType } from '../src/providers/provider-factory';
import type { ProvidersFileConfig } from '../src/providers/providers-config';

// Mock execAsync from pipeline-core for az-cli tests
vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        execAsync: vi.fn(),
    };
});

import { execAsync } from '@plusplusoneplusplus/pipeline-core';

// ── detectProviderType ────────────────────────────────────────────────────────

describe('ProviderFactory.detectProviderType', () => {
    it('returns GitHub for https github.com URL', () => {
        expect(ProviderFactory.detectProviderType('https://github.com/org/repo.git')).toBe(ProviderType.GitHub);
    });

    it('returns GitHub for SSH github.com URL', () => {
        expect(ProviderFactory.detectProviderType('git@github.com:org/repo.git')).toBe(ProviderType.GitHub);
    });

    it('returns ADO for dev.azure.com URL', () => {
        expect(ProviderFactory.detectProviderType('https://dev.azure.com/org/proj/_git/repo')).toBe(ProviderType.ADO);
    });

    it('returns ADO for visualstudio.com URL', () => {
        expect(ProviderFactory.detectProviderType('https://org.visualstudio.com/proj/_git/repo')).toBe(ProviderType.ADO);
    });

    it('returns null for unknown host', () => {
        expect(ProviderFactory.detectProviderType('https://gitlab.com/org/repo.git')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(ProviderFactory.detectProviderType('')).toBeNull();
    });
});

// ── parseGitHubRemote ─────────────────────────────────────────────────────────

describe('ProviderFactory.parseGitHubRemote', () => {
    it('parses HTTPS URL with .git suffix', () => {
        expect(ProviderFactory.parseGitHubRemote('https://github.com/myorg/myrepo.git')).toEqual({
            owner: 'myorg',
            repo: 'myrepo',
        });
    });

    it('parses HTTPS URL without .git suffix', () => {
        expect(ProviderFactory.parseGitHubRemote('https://github.com/myorg/myrepo')).toEqual({
            owner: 'myorg',
            repo: 'myrepo',
        });
    });

    it('parses SSH URL', () => {
        expect(ProviderFactory.parseGitHubRemote('git@github.com:myorg/myrepo.git')).toEqual({
            owner: 'myorg',
            repo: 'myrepo',
        });
    });

    it('parses SSH URL without .git suffix', () => {
        expect(ProviderFactory.parseGitHubRemote('git@github.com:myorg/myrepo')).toEqual({
            owner: 'myorg',
            repo: 'myrepo',
        });
    });

    it('returns null for non-GitHub URL', () => {
        expect(ProviderFactory.parseGitHubRemote('https://gitlab.com/org/repo.git')).toBeNull();
    });
});

// ── parseAdoRemote ────────────────────────────────────────────────────────────

describe('ProviderFactory.parseAdoRemote', () => {
    it('parses dev.azure.com URL', () => {
        expect(ProviderFactory.parseAdoRemote('https://dev.azure.com/myorg/myproject/_git/myrepo')).toEqual({
            orgUrl: 'https://dev.azure.com/myorg',
            project: 'myproject',
            repo: 'myrepo',
        });
    });

    it('parses visualstudio.com URL', () => {
        expect(ProviderFactory.parseAdoRemote('https://myorg.visualstudio.com/myproject/_git/myrepo')).toEqual({
            orgUrl: 'https://myorg.visualstudio.com',
            project: 'myproject',
            repo: 'myrepo',
        });
    });

    it('returns null for non-ADO URL', () => {
        expect(ProviderFactory.parseAdoRemote('https://github.com/org/repo.git')).toBeNull();
    });
});

// ── createPullRequestsService ─────────────────────────────────────────────────

describe('ProviderFactory.createPullRequestsService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: az CLI fails (not logged in)
        (execAsync as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('az: command not found'));
    });

    it('returns null when GitHub token is missing', async () => {
        const config: ProvidersFileConfig = { providers: {} };
        const result = await ProviderFactory.createPullRequestsService(
            'https://github.com/org/repo.git',
            config,
        );
        expect(result).toBeNull();
    });

    it('returns no-ado-credentials sentinel when ADO token is missing and az CLI fails', async () => {
        const config: ProvidersFileConfig = { providers: {} };
        const result = await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/org/proj/_git/repo',
            config,
        );
        expect(result).toEqual({ error: 'no-ado-credentials' });
    });

    it('returns a service when ADO token missing but az CLI succeeds', async () => {
        (execAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'bearer-token-xyz\n', stderr: '' });
        const config: ProvidersFileConfig = { providers: {} };
        const result = await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/org/proj/_git/repo',
            config,
        );
        expect(result).not.toBeNull();
        expect(result).not.toEqual({ error: 'no-ado-credentials' });
    });

    it('returns null for unknown provider URL', async () => {
        const config: ProvidersFileConfig = {
            providers: { github: { token: 'ghp_test' } },
        };
        const result = await ProviderFactory.createPullRequestsService(
            'https://gitlab.com/org/repo.git',
            config,
        );
        expect(result).toBeNull();
    });

    it('returns a service instance when GitHub token is present', async () => {
        const config: ProvidersFileConfig = {
            providers: { github: { token: 'ghp_testtoken123' } },
        };
        const result = await ProviderFactory.createPullRequestsService(
            'https://github.com/myorg/myrepo.git',
            config,
        );
        expect(result).not.toBeNull();
    });

    it('returns a service instance when ADO token and orgUrl are present', async () => {
        const config: ProvidersFileConfig = {
            providers: {
                ado: { token: 'ado-pat-token', orgUrl: 'https://dev.azure.com/myorg' },
            },
        };
        const result = await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/myorg/myproject/_git/myrepo',
            config,
        );
        expect(result).not.toBeNull();
        // az CLI should NOT be called when PAT is present
        expect(execAsync).not.toHaveBeenCalled();
    });

    it('returns null when GitHub remote URL cannot be parsed', async () => {
        const config: ProvidersFileConfig = {
            providers: { github: { token: 'ghp_testtoken' } },
        };
        // malformed GitHub URL
        const result = await ProviderFactory.createPullRequestsService(
            'https://github.com/',
            config,
        );
        expect(result).toBeNull();
    });

    it('returns no-ado-credentials sentinel when ADO remote cannot be parsed and no PAT', async () => {
        const config: ProvidersFileConfig = { providers: {} };
        // No orgUrl derivable from malformed ADO URL (empty string)
        const result = await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/',
            config,
        );
        expect(result).toEqual({ error: 'no-ado-credentials' });
    });
});
