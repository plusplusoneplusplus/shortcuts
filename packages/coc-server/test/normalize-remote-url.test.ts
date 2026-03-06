/**
 * Tests for normalizeRemoteUrl utility in api-handler.
 */

import { describe, it, expect } from 'vitest';
import { normalizeRemoteUrl } from '../src/api-handler';

describe('normalizeRemoteUrl', () => {
    // ── Standard formats ──────────────────────────────────────────────────────

    it('normalizes GitHub SSH URL', () => {
        expect(normalizeRemoteUrl('git@github.com:user/repo.git')).toBe('github.com/user/repo');
    });

    it('normalizes GitHub HTTPS URL', () => {
        expect(normalizeRemoteUrl('https://github.com/user/repo.git')).toBe('github.com/user/repo');
    });

    it('normalizes ssh:// protocol URL', () => {
        expect(normalizeRemoteUrl('ssh://git@github.com/user/repo')).toBe('github.com/user/repo');
    });

    it('normalizes git:// protocol URL', () => {
        expect(normalizeRemoteUrl('git://github.com/user/repo.git/')).toBe('github.com/user/repo');
    });

    // ── Azure DevOps formats ──────────────────────────────────────────────────

    it('normalizes Azure DevOps HTTPS URL', () => {
        expect(normalizeRemoteUrl('https://dev.azure.com/org/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Azure DevOps HTTPS URL with .git suffix', () => {
        expect(normalizeRemoteUrl('https://dev.azure.com/org/project/_git/repo.git'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Azure DevOps HTTPS URL with PAT auth', () => {
        expect(normalizeRemoteUrl('https://pat@dev.azure.com/org/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Azure DevOps SSH URL', () => {
        expect(normalizeRemoteUrl('git@ssh.dev.azure.com:v3/org/project/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes Azure DevOps SSH URL with .git suffix', () => {
        expect(normalizeRemoteUrl('git@ssh.dev.azure.com:v3/org/project/repo.git'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes old visualstudio.com HTTPS URL', () => {
        expect(normalizeRemoteUrl('https://org.visualstudio.com/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('normalizes visualstudio.com with DefaultCollection', () => {
        expect(normalizeRemoteUrl('https://org.visualstudio.com/DefaultCollection/project/_git/repo'))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('all Azure DevOps URL formats produce identical output', () => {
        const expected = 'dev.azure.com/myorg/myproject/myrepo';
        const urls = [
            'https://dev.azure.com/myorg/myproject/_git/myrepo',
            'git@ssh.dev.azure.com:v3/myorg/myproject/myrepo',
            'https://myorg.visualstudio.com/myproject/_git/myrepo',
            'https://myorg.visualstudio.com/DefaultCollection/myproject/_git/myrepo',
            'https://pat@dev.azure.com/myorg/myproject/_git/myrepo',
        ];
        for (const url of urls) {
            expect(normalizeRemoteUrl(url)).toBe(expected);
        }
    });
});
