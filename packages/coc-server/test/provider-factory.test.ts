/**
 * Tests for ProviderFactory — detectProviderType, parseGitHubRemote,
 * parseAdoRemote, and createPullRequestsService.
 */

import { describe, it, expect } from 'vitest';
import { ProviderFactory, ProviderType } from '../src/providers/provider-factory';
import type { ProvidersFileConfig } from '../src/providers/providers-config';

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
    it('returns null when GitHub token is missing', () => {
        const config: ProvidersFileConfig = { providers: {} };
        const result = ProviderFactory.createPullRequestsService(
            'https://github.com/org/repo.git',
            config,
        );
        expect(result).toBeNull();
    });

    it('returns null when ADO token is missing', () => {
        const config: ProvidersFileConfig = { providers: {} };
        const result = ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/org/proj/_git/repo',
            config,
        );
        expect(result).toBeNull();
    });

    it('returns null for unknown provider URL', () => {
        const config: ProvidersFileConfig = {
            providers: { github: { token: 'ghp_test' } },
        };
        const result = ProviderFactory.createPullRequestsService(
            'https://gitlab.com/org/repo.git',
            config,
        );
        expect(result).toBeNull();
    });

    it('returns a service instance when GitHub token is present', () => {
        const config: ProvidersFileConfig = {
            providers: { github: { token: 'ghp_testtoken123' } },
        };
        const result = ProviderFactory.createPullRequestsService(
            'https://github.com/myorg/myrepo.git',
            config,
        );
        expect(result).not.toBeNull();
    });

    it('returns a service instance when ADO token and orgUrl are present', () => {
        const config: ProvidersFileConfig = {
            providers: {
                ado: { token: 'ado-pat-token', orgUrl: 'https://dev.azure.com/myorg' },
            },
        };
        const result = ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/myorg/myproject/_git/myrepo',
            config,
        );
        expect(result).not.toBeNull();
    });

    it('returns null when GitHub remote URL cannot be parsed', () => {
        const config: ProvidersFileConfig = {
            providers: { github: { token: 'ghp_testtoken' } },
        };
        // malformed GitHub URL
        const result = ProviderFactory.createPullRequestsService(
            'https://github.com/',
            config,
        );
        expect(result).toBeNull();
    });
});
