/**
 * Tests for ProviderFactory — detectProviderType, parseGitHubRemote,
 * parseAdoRemote, and createPullRequestsService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderFactory, ProviderType } from '../../src/server/providers/provider-factory';
import type { ProvidersFileConfig } from '../../src/server/providers/providers-config';

// Mock execAsync, createAdoPullRequestsAdapter, and getOrResolveAdoUserId from forge
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        execAsync: vi.fn(),
        createAdoPullRequestsAdapter: vi.fn(actual.createAdoPullRequestsAdapter),
        getOrResolveAdoUserId: vi.fn(),
        clearAdoSessionCache: vi.fn(),
    };
});

import { execAsync, createAdoPullRequestsAdapter, getOrResolveAdoUserId, clearAdoSessionCache } from '@plusplusoneplusplus/forge';

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

    it('parses visualstudio.com URL with DefaultCollection', () => {
        expect(
            ProviderFactory.parseAdoRemote(
                'https://myorg.visualstudio.com/DefaultCollection/myproject/_git/myrepo',
            ),
        ).toEqual({
            orgUrl: 'https://myorg.visualstudio.com',
            project: 'myproject',
            repo: 'myrepo',
        });
    });

    it('parses visualstudio.com URL with custom collection name', () => {
        expect(
            ProviderFactory.parseAdoRemote(
                'https://myorg.visualstudio.com/MyCollection/myproject/_git/myrepo',
            ),
        ).toEqual({
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
        // Default: no cached user identity
        (getOrResolveAdoUserId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    });

    it('returns null when GitHub token is missing', async () => {
        const config: ProvidersFileConfig = { providers: {} };
        const result = await ProviderFactory.createPullRequestsService(
            'https://github.com/org/repo.git',
            config,
        );
        expect(result).toBeNull();
    });

    it('returns no-ado-credentials sentinel when az CLI fails', async () => {
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

    it('force-refreshes the Azure CLI token and clears the ADO session cache when requested', async () => {
        (execAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'fresh-token\n', stderr: '' });
        const config: ProvidersFileConfig = { providers: {} };
        await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/org/proj/_git/repo',
            config,
            { forceRefresh: true, dataDir: 'coc-data' },
        );

        expect(clearAdoSessionCache).toHaveBeenCalledWith('coc-data');
        expect(execAsync).toHaveBeenCalledWith(
            'az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv --force-refresh',
        );
        expect(createAdoPullRequestsAdapter).toHaveBeenCalledWith(
            expect.objectContaining({ token: 'fresh-token' }),
        );
    });

    it('does not clear the ADO session cache without force refresh', async () => {
        (execAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'bearer-token\n', stderr: '' });
        const config: ProvidersFileConfig = { providers: {} };
        await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/org/proj/_git/repo',
            config,
        );

        expect(clearAdoSessionCache).not.toHaveBeenCalled();
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

    it('returns a service instance when ADO orgUrl is configured and az CLI succeeds', async () => {
        (execAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'bearer-token-xyz\n', stderr: '' });
        const config: ProvidersFileConfig = {
            providers: {
                ado: { orgUrl: 'https://dev.azure.com/myorg' },
            },
        };
        const result = await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/myorg/myproject/_git/myrepo',
            config,
        );
        expect(result).not.toBeNull();
        expect(result).not.toEqual({ error: 'no-ado-credentials' });
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

    it('returns no-ado-credentials sentinel when ADO remote cannot be parsed', async () => {
        const config: ProvidersFileConfig = { providers: {} };
        // No orgUrl derivable from malformed ADO URL (empty string)
        const result = await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/',
            config,
        );
        expect(result).toEqual({ error: 'no-ado-credentials' });
    });

    it('passes parsed repo name to createAdoPullRequestsAdapter (regression: workspace ID bug)', async () => {
        (execAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'bearer-token-xyz\n', stderr: '' });
        const config: ProvidersFileConfig = { providers: {} };
        await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/org/proj/_git/MyRepo',
            config,
        );
        expect(createAdoPullRequestsAdapter).toHaveBeenCalledWith(
            expect.objectContaining({ repo: 'MyRepo' }),
        );
    });

    it('passes cached ADO user ID as currentUserId', async () => {
        (execAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'bearer-token\n', stderr: '' });
        (getOrResolveAdoUserId as ReturnType<typeof vi.fn>).mockResolvedValue('ado-guid-123');
        const config: ProvidersFileConfig = { providers: {} };
        await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/org/proj/_git/repo',
            config,
        );
        expect(getOrResolveAdoUserId).toHaveBeenCalledWith('https://dev.azure.com/org', 'bearer-token');
        expect(createAdoPullRequestsAdapter).toHaveBeenCalledWith(
            expect.objectContaining({ currentUserId: 'ado-guid-123' }),
        );
    });

    it('creates adapter without currentUserId when identity resolution returns null', async () => {
        (execAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'bearer-token\n', stderr: '' });
        (getOrResolveAdoUserId as ReturnType<typeof vi.fn>).mockResolvedValue(null);
        const config: ProvidersFileConfig = { providers: {} };
        await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/org/proj/_git/repo',
            config,
        );
        expect(createAdoPullRequestsAdapter).toHaveBeenCalledWith(
            expect.objectContaining({ currentUserId: undefined }),
        );
    });

    it('creates adapter without currentUserId when identity resolution throws', async () => {
        (execAsync as ReturnType<typeof vi.fn>).mockResolvedValue({ stdout: 'bearer-token\n', stderr: '' });
        (getOrResolveAdoUserId as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));
        const config: ProvidersFileConfig = { providers: {} };
        const result = await ProviderFactory.createPullRequestsService(
            'https://dev.azure.com/org/proj/_git/repo',
            config,
        );
        // Should still return a valid service, not throw
        expect(result).not.toBeNull();
        expect(result).not.toEqual({ error: 'no-ado-credentials' });
        expect(createAdoPullRequestsAdapter).toHaveBeenCalledWith(
            expect.objectContaining({ currentUserId: undefined }),
        );
    });
});
