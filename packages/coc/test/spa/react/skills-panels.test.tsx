import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { SkillsBundledPanel } from '../../../src/server/spa/client/react/features/skills/SkillsBundledPanel';
import { SkillsConfigPanel } from '../../../src/server/spa/client/react/features/skills/SkillsConfigPanel';
import { SkillsInstalledPanel } from '../../../src/server/spa/client/react/features/skills/SkillsInstalledPanel';
import { resetSpaCocClientForTests } from '../../../src/server/spa/client/react/api/cocClient';

const fetchMock = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock;
    resetSpaCocClientForTests();
});

describe('skills SPA client migration panels', () => {
    it('loads bundled skills and installs selected global bundled skills through the typed client', async () => {
        fetchMock.mockImplementation((url: string, options?: RequestInit) => {
            if (url === '/api/skills/bundled') {
                return jsonResponse({ skills: [{ name: 'impl', description: 'Implement changes', path: 'impl', alreadyExists: false }] });
            }
            if (url === '/api/skills/install' && options?.method === 'POST') {
                return jsonResponse({ installed: 1, skipped: 0, failed: 0, details: [] });
            }
            return jsonResponse({});
        });

        render(<SkillsBundledPanel />);

        const item = await screen.findByTestId('skills-bundled-item-impl');
        fireEvent.click(within(item).getByRole('checkbox'));
        fireEvent.click(screen.getByText('Install Selected (1)'));

        await waitFor(() => {
            const installCall = findFetchCall('/api/skills/install', 'POST');
            expect(JSON.parse(installCall![1]!.body as string)).toEqual({
                source: 'bundled',
                skills: ['impl'],
                replace: true,
            });
        });
    });

    it('scans a URL and installs discovered skills through typed global skill methods', async () => {
        fetchMock.mockImplementation((url: string, options?: RequestInit) => {
            if (url === '/api/skills/bundled') {
                return jsonResponse({ skills: [] });
            }
            if (url === '/api/skills/scan' && options?.method === 'POST') {
                return jsonResponse({
                    success: true,
                    skills: [{ name: 'review', description: 'Review code', path: 'skills/review', alreadyExists: false }],
                });
            }
            if (url === '/api/skills/install' && options?.method === 'POST') {
                return jsonResponse({ installed: 1, skipped: 0, failed: 0, details: [] });
            }
            return jsonResponse({});
        });

        render(<SkillsBundledPanel />);
        await screen.findByText('GitHub URL');

        fireEvent.click(screen.getByText('GitHub URL'));
        fireEvent.change(screen.getByPlaceholderText('https://github.com/user/repo'), {
            target: { value: 'https://github.com/owner/repo' },
        });
        fireEvent.click(screen.getByText('Scan'));

        await screen.findByText('review');
        fireEvent.click(screen.getByText('Install All'));

        await waitFor(() => {
            const scanCall = findFetchCall('/api/skills/scan', 'POST');
            const installCall = findFetchCall('/api/skills/install', 'POST');
            expect(JSON.parse(scanCall![1]!.body as string)).toEqual({ url: 'https://github.com/owner/repo' });
            expect(JSON.parse(installCall![1]!.body as string)).toEqual({
                url: 'https://github.com/owner/repo',
                skillsToInstall: [{ name: 'review', description: 'Review code', path: 'skills/review', alreadyExists: false }],
                replace: true,
            });
        });
    });

    it('loads and updates global skills config through typed methods', async () => {
        fetchMock.mockImplementation((url: string, options?: RequestInit) => {
            if (url === '/api/skills/config' && options?.method === 'PUT') {
                return jsonResponse({ globalDisabledSkills: ['legacy', 'impl'], globalSkillsDir: 'C:\\data\\skills' });
            }
            if (url === '/api/skills/config') {
                return jsonResponse({ globalDisabledSkills: ['legacy'], globalSkillsDir: 'C:\\data\\skills' });
            }
            return jsonResponse({});
        });

        render(<SkillsConfigPanel />);

        await screen.findByText('C:\\data\\skills');
        fireEvent.change(screen.getByPlaceholderText('Skill name to disable…'), { target: { value: 'impl' } });
        fireEvent.click(screen.getByText('Disable'));

        await waitFor(() => {
            const putCall = findFetchCall('/api/skills/config', 'PUT');
            expect(JSON.parse(putCall![1]!.body as string)).toEqual({ globalDisabledSkills: ['legacy', 'impl'] });
        });
    });

    it('loads installed skills, toggles config, expands details, and deletes through typed methods', async () => {
        fetchMock.mockImplementation((url: string, options?: RequestInit) => {
            if (url === '/api/skills' && !options?.method) {
                return jsonResponse({ skills: [{ name: 'impl', description: 'Implement changes', version: '1.0' }] });
            }
            if (url === '/api/skills/config' && options?.method === 'PUT') {
                return jsonResponse({ globalDisabledSkills: ['impl'], globalSkillsDir: 'C:\\data\\skills' });
            }
            if (url === '/api/skills/config') {
                return jsonResponse({ globalDisabledSkills: [], globalSkillsDir: 'C:\\data\\skills' });
            }
            if (url === '/api/skills/impl' && !options?.method) {
                return jsonResponse({ skill: { name: 'impl', promptBody: 'Do implementation work' } });
            }
            if (url === '/api/skills/impl' && options?.method === 'DELETE') {
                return emptyResponse(204);
            }
            return jsonResponse({});
        });

        render(<SkillsInstalledPanel />);

        await screen.findByTestId('skills-installed-item-impl');
        fireEvent.click(screen.getByTestId('skills-installed-expand-impl'));
        await screen.findByText('Do implementation work');
        fireEvent.click(screen.getByTestId('skills-installed-toggle-impl'));
        fireEvent.click(screen.getByTestId('skills-installed-delete-btn-impl'));
        fireEvent.click(screen.getByTestId('skills-installed-delete-confirm-impl'));

        await waitFor(() => {
            const putCall = findFetchCall('/api/skills/config', 'PUT');
            expect(JSON.parse(putCall![1]!.body as string)).toEqual({ globalDisabledSkills: ['impl'] });
            expect(findFetchCall('/api/skills/impl', 'DELETE')).toBeDefined();
        });
    });
});

function findFetchCall(url: string, method: string): [string, RequestInit | undefined] | undefined {
    return fetchMock.mock.calls.find(([callUrl, options]: [string, RequestInit | undefined]) => (
        callUrl === url && options?.method === method
    ));
}

function jsonResponse(body: unknown): Promise<Response> {
    return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(body),
    } as unknown as Response);
}

function emptyResponse(status: number): Promise<Response> {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: { get: () => '' },
    } as unknown as Response);
}
