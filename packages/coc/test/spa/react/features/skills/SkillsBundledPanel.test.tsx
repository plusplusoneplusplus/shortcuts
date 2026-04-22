/**
 * Tests for SkillsBundledPanel component.
 *
 * Covers: initial load, install-selected, install-all, URL scan,
 * install-from-URL, error handling, and source-tab switching.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SkillsBundledPanel } from '../../../../../src/server/spa/client/react/features/skills/SkillsBundledPanel';

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

import { fetchApi } from '../../../../../src/server/spa/client/react/hooks/useApi';

const mockFetchApi = fetchApi as ReturnType<typeof vi.fn>;

afterEach(() => {
    vi.clearAllMocks();
});

const makeSkill = (name: string, overrides: Record<string, any> = {}) => ({
    name,
    description: `${name} skill`,
    ...overrides,
});

describe('SkillsBundledPanel', () => {
    // ── Initial render ──────────────────────────────────────────────

    it('shows loading state while fetching bundled skills', () => {
        mockFetchApi.mockReturnValue(new Promise(() => {}));
        render(<SkillsBundledPanel />);
        expect(screen.getByText('Loading gallery…')).toBeTruthy();
    });

    it('renders bundled skill list from API', async () => {
        mockFetchApi.mockResolvedValueOnce({ skills: [makeSkill('alpha'), makeSkill('beta')] });
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-bundled-item-alpha')).toBeTruthy();
            expect(screen.getByTestId('skills-bundled-item-beta')).toBeTruthy();
        });
        expect(screen.getByText('2 skill(s) available')).toBeTruthy();
    });

    it('shows installed badge for skills with alreadyExists flag', async () => {
        mockFetchApi.mockResolvedValueOnce({
            skills: [makeSkill('alpha', { alreadyExists: true }), makeSkill('beta')],
        });
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('installed')).toBeTruthy();
        });
    });

    it('shows skill description when present', async () => {
        mockFetchApi.mockResolvedValueOnce({
            skills: [makeSkill('alpha', { description: 'Runs analysis' })],
        });
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('Runs analysis')).toBeTruthy();
        });
    });

    it('handles API returning no skills property', async () => {
        mockFetchApi.mockResolvedValueOnce({});
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('0 skill(s) available')).toBeTruthy();
        });
    });

    it('handles API fetch error gracefully', async () => {
        mockFetchApi.mockRejectedValueOnce(new Error('Network error'));
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('0 skill(s) available')).toBeTruthy();
        });
    });

    // ── Selection ───────────────────────────────────────────────────

    it('toggles skill selection via checkbox', async () => {
        mockFetchApi.mockResolvedValueOnce({ skills: [makeSkill('alpha'), makeSkill('beta')] });
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-bundled-item-alpha')).toBeTruthy();
        });
        const checkbox = screen.getByTestId('skills-bundled-item-alpha').querySelector('input[type="checkbox"]')!;
        // Select
        fireEvent.click(checkbox);
        expect(screen.getByText('Install Selected (1)')).toBeTruthy();
        // Deselect
        fireEvent.click(checkbox);
        expect(screen.queryByText(/Install Selected/)).toBeNull();
    });

    it('tracks multiple selected skills', async () => {
        mockFetchApi.mockResolvedValueOnce({ skills: [makeSkill('a'), makeSkill('b'), makeSkill('c')] });
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-bundled-item-a')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('skills-bundled-item-a').querySelector('input[type="checkbox"]')!);
        fireEvent.click(screen.getByTestId('skills-bundled-item-c').querySelector('input[type="checkbox"]')!);
        expect(screen.getByText('Install Selected (2)')).toBeTruthy();
    });

    // ── Install Selected ────────────────────────────────────────────

    it('installs selected skills and refreshes list on success', async () => {
        mockFetchApi
            .mockResolvedValueOnce({ skills: [makeSkill('alpha'), makeSkill('beta')] }) // initial load
            .mockResolvedValueOnce(undefined) // install POST
            .mockResolvedValueOnce({ skills: [makeSkill('beta')] }); // reload
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-bundled-item-alpha')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('skills-bundled-item-alpha').querySelector('input[type="checkbox"]')!);
        fireEvent.click(screen.getByText('Install Selected (1)'));
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith('/skills/install', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ source: 'bundled', skills: ['alpha'], replace: true }),
            }));
        });
        // After reload, alpha is gone
        await waitFor(() => {
            expect(screen.queryByTestId('skills-bundled-item-alpha')).toBeNull();
            expect(screen.getByTestId('skills-bundled-item-beta')).toBeTruthy();
        });
    });

    it('keeps selection when install fails', async () => {
        mockFetchApi
            .mockResolvedValueOnce({ skills: [makeSkill('alpha')] }) // initial load
            .mockRejectedValueOnce(new Error('500')); // install fails
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-bundled-item-alpha')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('skills-bundled-item-alpha').querySelector('input[type="checkbox"]')!);
        fireEvent.click(screen.getByText('Install Selected (1)'));
        // Selection persists after error
        await waitFor(() => {
            expect(screen.getByText('Install Selected (1)')).toBeTruthy();
        });
    });

    // ── Install All ─────────────────────────────────────────────────

    it('installs all bundled skills and refreshes list', async () => {
        mockFetchApi
            .mockResolvedValueOnce({ skills: [makeSkill('alpha'), makeSkill('beta')] }) // initial load
            .mockResolvedValueOnce(undefined) // install POST
            .mockResolvedValueOnce({ skills: [] }); // reload (all installed)
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-install-all-btn')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('skills-install-all-btn'));
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith('/skills/install', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ source: 'bundled', replace: true }),
            }));
        });
    });

    it('disables install buttons while install is in progress', async () => {
        let resolveInstall!: (v: any) => void;
        mockFetchApi
            .mockResolvedValueOnce({ skills: [makeSkill('alpha')] }) // initial load
            .mockImplementationOnce(() => new Promise(r => { resolveInstall = r; })); // pending install
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-install-all-btn')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('skills-install-all-btn'));
        await waitFor(() => {
            expect((screen.getByTestId('skills-install-all-btn') as HTMLButtonElement).disabled).toBe(true);
        });
        // Resolve to clean up
        mockFetchApi.mockResolvedValueOnce({ skills: [] });
        resolveInstall(undefined);
    });

    it('re-enables install buttons after install failure', async () => {
        mockFetchApi
            .mockResolvedValueOnce({ skills: [makeSkill('alpha')] }) // initial load
            .mockRejectedValueOnce(new Error('Server error')); // install fails
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-install-all-btn')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('skills-install-all-btn'));
        await waitFor(() => {
            expect((screen.getByTestId('skills-install-all-btn') as HTMLButtonElement).disabled).toBe(false);
        });
    });

    // ── Source tab switching ─────────────────────────────────────────

    it('switches to GitHub URL tab and shows URL input', async () => {
        mockFetchApi.mockResolvedValueOnce({ skills: [] });
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('GitHub URL')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('GitHub URL'));
        expect(screen.getByPlaceholderText('https://github.com/user/repo')).toBeTruthy();
    });

    it('switches to Local Path tab and shows path input', async () => {
        mockFetchApi.mockResolvedValueOnce({ skills: [] });
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('Local Path')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('Local Path'));
        expect(screen.getByPlaceholderText('/path/to/skills or ./my-skill')).toBeTruthy();
    });

    it('clears scan state when switching tabs', async () => {
        mockFetchApi
            .mockResolvedValueOnce({ skills: [] }) // initial load
            .mockResolvedValueOnce({ skills: [{ name: 'remote-a' }] }); // scan result
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('GitHub URL')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('GitHub URL'));
        fireEvent.change(screen.getByPlaceholderText('https://github.com/user/repo'), {
            target: { value: 'https://github.com/user/skills' },
        });
        fireEvent.click(screen.getByText('Scan'));
        await waitFor(() => {
            expect(screen.getByText('remote-a')).toBeTruthy();
        });
        // Switch to Local Path — scan state should reset
        fireEvent.click(screen.getByText('Local Path'));
        expect(screen.queryByText('remote-a')).toBeNull();
    });

    // ── URL Scan ────────────────────────────────────────────────────

    it('scans URL and shows discovered skills', async () => {
        mockFetchApi
            .mockResolvedValueOnce({ skills: [] }) // initial load
            .mockResolvedValueOnce({
                skills: [{ name: 'remote-skill', description: 'Does stuff' }],
            }); // scan result
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('GitHub URL')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('GitHub URL'));
        fireEvent.change(screen.getByPlaceholderText('https://github.com/user/repo'), {
            target: { value: 'https://github.com/user/skills-repo' },
        });
        fireEvent.click(screen.getByText('Scan'));
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith('/skills/scan', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ url: 'https://github.com/user/skills-repo' }),
            }));
            expect(screen.getByText('remote-skill')).toBeTruthy();
            expect(screen.getByText(/Found 1 skill/)).toBeTruthy();
        });
    });

    it('shows scanning indicator while scan is in progress', async () => {
        let resolveScan!: (v: any) => void;
        mockFetchApi
            .mockResolvedValueOnce({ skills: [] }) // initial load
            .mockImplementationOnce(() => new Promise(r => { resolveScan = r; })); // pending scan
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('GitHub URL')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('GitHub URL'));
        fireEvent.change(screen.getByPlaceholderText('https://github.com/user/repo'), {
            target: { value: 'https://github.com/user/repo' },
        });
        fireEvent.click(screen.getByText('Scan'));
        await waitFor(() => {
            expect(screen.getByText('Scanning…')).toBeTruthy();
        });
        resolveScan({ skills: [] });
    });

    it('disables scan button when input is empty', async () => {
        mockFetchApi.mockResolvedValueOnce({ skills: [] });
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('GitHub URL')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('GitHub URL'));
        expect((screen.getByText('Scan') as HTMLButtonElement).disabled).toBe(true);
    });

    it('shows fallback error when scan fetch throws', async () => {
        mockFetchApi
            .mockResolvedValueOnce({ skills: [] }) // initial load
            .mockRejectedValueOnce(new Error('Network error')); // scan throws
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('GitHub URL')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('GitHub URL'));
        fireEvent.change(screen.getByPlaceholderText('https://github.com/user/repo'), {
            target: { value: 'https://github.com/user/repo' },
        });
        fireEvent.click(screen.getByText('Scan'));
        await waitFor(() => {
            expect(screen.getByText('Scan failed')).toBeTruthy();
        });
    });

    it('shows error message from unsuccessful scan response', async () => {
        mockFetchApi
            .mockResolvedValueOnce({ skills: [] }) // initial load
            .mockResolvedValueOnce({ success: false, error: 'Repository not found' }); // scan error
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('GitHub URL')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('GitHub URL'));
        fireEvent.change(screen.getByPlaceholderText('https://github.com/user/repo'), {
            target: { value: 'https://github.com/user/nonexistent' },
        });
        fireEvent.click(screen.getByText('Scan'));
        await waitFor(() => {
            expect(screen.getByText('Repository not found')).toBeTruthy();
        });
    });

    // ── Install from URL ────────────────────────────────────────────

    it('installs skills discovered from URL scan', async () => {
        const scannedSkills = [{ name: 'remote-a' }, { name: 'remote-b' }];
        mockFetchApi
            .mockResolvedValueOnce({ skills: [] }) // initial load
            .mockResolvedValueOnce({ skills: scannedSkills }) // scan result
            .mockResolvedValueOnce(undefined) // install POST
            .mockResolvedValueOnce({ skills: [] }); // reload after install
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('GitHub URL')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('GitHub URL'));
        fireEvent.change(screen.getByPlaceholderText('https://github.com/user/repo'), {
            target: { value: 'https://github.com/user/skills' },
        });
        fireEvent.click(screen.getByText('Scan'));
        await waitFor(() => {
            expect(screen.getByText('remote-a')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('Install All'));
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith('/skills/install', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    url: 'https://github.com/user/skills',
                    skillsToInstall: scannedSkills,
                    replace: true,
                }),
            }));
        });
    });

    it('clears scan result and input after successful URL install', async () => {
        const scannedSkills = [{ name: 'remote-a' }];
        mockFetchApi
            .mockResolvedValueOnce({ skills: [] }) // initial load
            .mockResolvedValueOnce({ skills: scannedSkills }) // scan result
            .mockResolvedValueOnce(undefined) // install POST
            .mockResolvedValueOnce({ skills: [] }); // reload after install
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByText('GitHub URL')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('GitHub URL'));
        const input = screen.getByPlaceholderText('https://github.com/user/repo') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'https://github.com/user/skills' } });
        fireEvent.click(screen.getByText('Scan'));
        await waitFor(() => {
            expect(screen.getByText('remote-a')).toBeTruthy();
        });
        fireEvent.click(screen.getByText('Install All'));
        await waitFor(() => {
            expect((screen.getByPlaceholderText('https://github.com/user/repo') as HTMLInputElement).value).toBe('');
            expect(screen.queryByText('remote-a')).toBeNull();
        });
    });

    // ── Refresh ─────────────────────────────────────────────────────

    it('reloads bundled skills on refresh click', async () => {
        mockFetchApi
            .mockResolvedValueOnce({ skills: [makeSkill('alpha')] }) // initial load
            .mockResolvedValueOnce({ skills: [makeSkill('alpha'), makeSkill('beta')] }); // reload
        render(<SkillsBundledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-bundled-item-alpha')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('skills-gallery-refresh-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('skills-bundled-item-beta')).toBeTruthy();
        });
    });
});
