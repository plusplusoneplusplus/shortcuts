/**
 * Tests for SkillsConfigPanel component.
 *
 * Covers: initial load, global directory display + fallback, disabled-skills
 * badges, add/remove disabled skill, duplicate prevention, Enter-key support,
 * empty state, error handling, global extra skill folders (add/remove/dup),
 * auto-detect toggle, detected-folder concise display + diagnostics, and the
 * read-only effective search order with source/status badges.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { SkillsConfigPanel } from '../../../../../src/server/spa/client/react/features/skills/SkillsConfigPanel';

const mockFetchApi = vi.hoisted(() => vi.fn());
const mockGetEffectivePaths = vi.hoisted(() => vi.fn());

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        skills: {
            getGlobalConfig: () => mockFetchApi('/skills/config'),
            updateGlobalConfig: (body: unknown) => mockFetchApi('/skills/config', {
                method: 'PUT',
                body: JSON.stringify(body),
            }),
            getEffectivePaths: (workspaceId?: string) => mockGetEffectivePaths(workspaceId),
        },
    }),
}));

beforeEach(() => {
    // Default: global-only effective view with no paths. Individual tests override
    // with mockResolvedValueOnce for specific path shapes.
    mockGetEffectivePaths.mockResolvedValue({ paths: [] });
});

afterEach(() => {
    vi.clearAllMocks();
});

const makeConfig = (overrides: Record<string, any> = {}) => ({
    globalDisabledSkills: [],
    globalSkillsDir: '',
    globalExtraFolders: [],
    autoDetectDefaultFolders: true,
    ...overrides,
});

describe('SkillsConfigPanel', () => {
    // ── Loading state ──────────────────────────────────────────────────

    it('shows loading state initially', () => {
        mockFetchApi.mockReturnValue(new Promise(() => {}));
        render(<SkillsConfigPanel />);
        expect(screen.getByText('Loading config…')).toBeTruthy();
    });

    // ── Global skills directory ────────────────────────────────────────

    it('renders global skills directory from API', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({ globalSkillsDir: '/custom/skills/dir' }));
        render(<SkillsConfigPanel />);
        await waitFor(() => {
            expect(screen.getByText('/custom/skills/dir')).toBeTruthy();
        });
    });

    it('shows default directory when API returns empty string', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({ globalSkillsDir: '' }));
        render(<SkillsConfigPanel />);
        await waitFor(() => {
            expect(screen.getByText('~/.coc/skills/')).toBeTruthy();
        });
    });

    it('falls back to ~/.coc/skills/ when server omits globalSkillsDir (AC #1)', async () => {
        // Config payload with no globalSkillsDir key at all.
        mockFetchApi.mockResolvedValueOnce({ globalDisabledSkills: [], globalExtraFolders: [] });
        render(<SkillsConfigPanel />);
        await waitFor(() => {
            expect(screen.getByText('~/.coc/skills/')).toBeTruthy();
        });
    });

    // ── Disabled skills list ───────────────────────────────────────────

    it('renders disabled skills as badges', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({
            globalDisabledSkills: ['skill-a', 'skill-b'],
        }));
        render(<SkillsConfigPanel />);
        await waitFor(() => {
            expect(screen.getByText('skill-a')).toBeTruthy();
            expect(screen.getByText('skill-b')).toBeTruthy();
        });
    });

    it('shows empty state when no skills are disabled', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({ globalDisabledSkills: [] }));
        render(<SkillsConfigPanel />);
        await waitFor(() => {
            expect(screen.getByText('No globally disabled skills.')).toBeTruthy();
        });
    });

    // ── Adding a disabled skill ────────────────────────────────────────

    it('adds new skill to disabled list via Disable button', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig())       // GET /skills/config
            .mockResolvedValueOnce(undefined);          // PUT /skills/config
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Skill name to disable…');
        fireEvent.change(input, { target: { value: 'new-skill' } });
        fireEvent.click(screen.getByText('Disable'));

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({ globalDisabledSkills: ['new-skill'] }),
                }),
            );
        });
        // Skill badge appears in the DOM
        expect(screen.getByText('new-skill')).toBeTruthy();
    });

    it('adds skill when Enter key is pressed in the input', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig())
            .mockResolvedValueOnce(undefined);
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Skill name to disable…');
        fireEvent.change(input, { target: { value: 'enter-skill' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({ globalDisabledSkills: ['enter-skill'] }),
                }),
            );
        });
    });

    it('clears input after adding a skill', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig())
            .mockResolvedValueOnce(undefined);
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Skill name to disable…') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'some-skill' } });
        fireEvent.click(screen.getByText('Disable'));

        await waitFor(() => {
            expect(input.value).toBe('');
        });
    });

    it('trims whitespace from skill name before adding', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig())
            .mockResolvedValueOnce(undefined);
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Skill name to disable…');
        fireEvent.change(input, { target: { value: '  trimmed-skill  ' } });
        fireEvent.click(screen.getByText('Disable'));

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    body: JSON.stringify({ globalDisabledSkills: ['trimmed-skill'] }),
                }),
            );
        });
    });

    // ── Duplicate prevention ───────────────────────────────────────────

    it('does not add duplicate disabled skill', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({
            globalDisabledSkills: ['existing-skill'],
        }));
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Skill name to disable…');
        fireEvent.change(input, { target: { value: 'existing-skill' } });
        fireEvent.click(screen.getByText('Disable'));

        // Only the initial GET should have been called
        expect(mockFetchApi).toHaveBeenCalledTimes(1);
    });

    it('does not add empty skill name', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig());
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Skill name to disable…');
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        // Only the initial GET should have been called
        expect(mockFetchApi).toHaveBeenCalledTimes(1);
    });

    // ── Removing a disabled skill ──────────────────────────────────────

    it('removes skill from disabled list when ✕ is clicked', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig({ globalDisabledSkills: ['only-skill'] }))
            .mockResolvedValueOnce(undefined);
        render(<SkillsConfigPanel />);

        const removeBtn = await screen.findByTitle('Re-enable');
        fireEvent.click(removeBtn);

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({ globalDisabledSkills: [] }),
                }),
            );
        });
        // Badge should be gone
        expect(screen.queryByText('only-skill')).toBeNull();
    });

    it('removes only the clicked skill when multiple are disabled', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig({ globalDisabledSkills: ['keep-me', 'remove-me'] }))
            .mockResolvedValueOnce(undefined);
        render(<SkillsConfigPanel />);

        await waitFor(() => {
            expect(screen.getByText('keep-me')).toBeTruthy();
            expect(screen.getByText('remove-me')).toBeTruthy();
        });

        // Click the ✕ for "remove-me" (second Re-enable button)
        const removeBtns = screen.getAllByTitle('Re-enable');
        fireEvent.click(removeBtns[1]);

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    body: JSON.stringify({ globalDisabledSkills: ['keep-me'] }),
                }),
            );
        });
        expect(screen.getByText('keep-me')).toBeTruthy();
        expect(screen.queryByText('remove-me')).toBeNull();
    });

    // ── Disable button state ───────────────────────────────────────────

    it('disables the Disable button when input is empty', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig());
        render(<SkillsConfigPanel />);

        const btn = await screen.findByRole('button', { name: 'Disable' }) as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('enables the Disable button when input has text', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig());
        render(<SkillsConfigPanel />);

        const btn = await screen.findByRole('button', { name: 'Disable' }) as HTMLButtonElement;
        const input = screen.getByPlaceholderText('Skill name to disable…');

        fireEvent.change(input, { target: { value: 'something' } });
        expect(btn.disabled).toBe(false);
    });

    // ── Error handling ─────────────────────────────────────────────────

    it('renders normally when initial load fails', async () => {
        mockFetchApi.mockRejectedValueOnce(new Error('Network error'));
        render(<SkillsConfigPanel />);

        // Should exit loading state and render the panel (with defaults)
        await waitFor(() => {
            expect(screen.getByText('No globally disabled skills.')).toBeTruthy();
            expect(screen.getByText('~/.coc/skills/')).toBeTruthy();
        });
    });

    it('keeps optimistic update when save fails', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig())
            .mockRejectedValueOnce(new Error('Save failed'));
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Skill name to disable…');
        fireEvent.change(input, { target: { value: 'optimistic-skill' } });
        fireEvent.click(screen.getByText('Disable'));

        // Badge stays visible even though save failed (fire-and-forget)
        await waitFor(() => {
            expect(screen.getByText('optimistic-skill')).toBeTruthy();
        });
    });

    // ── Data integrity ─────────────────────────────────────────────────

    it('handles API response with missing fields gracefully', async () => {
        mockFetchApi.mockResolvedValueOnce({});
        render(<SkillsConfigPanel />);

        await waitFor(() => {
            expect(screen.getByText('No globally disabled skills.')).toBeTruthy();
            expect(screen.getByText('~/.coc/skills/')).toBeTruthy();
        });
    });

    it('appends to existing disabled list when adding a new skill', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig({ globalDisabledSkills: ['first'] }))
            .mockResolvedValueOnce(undefined);
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Skill name to disable…');
        fireEvent.change(input, { target: { value: 'second' } });
        fireEvent.click(screen.getByText('Disable'));

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    body: JSON.stringify({ globalDisabledSkills: ['first', 'second'] }),
                }),
            );
        });
    });

    // ── Global extra skill folders (AC #2 / #5) ────────────────────────

    it('renders configured global extra folders as chips', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({
            globalExtraFolders: ['/opt/shared/skills', '~/team/skills'],
        }));
        render(<SkillsConfigPanel />);

        const section = await screen.findByTestId('skills-global-extra-folders');
        await waitFor(() => {
            expect(within(section).getByText('/opt/shared/skills')).toBeTruthy();
            expect(within(section).getByText('~/team/skills')).toBeTruthy();
        });
    });

    it('shows empty state when no global extra folders configured', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({ globalExtraFolders: [] }));
        render(<SkillsConfigPanel />);

        await waitFor(() => {
            expect(screen.getByText('No global extra folders configured.')).toBeTruthy();
        });
    });

    it('adds a global extra folder via the Add button', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig())       // GET
            .mockResolvedValueOnce(undefined);          // PUT
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Extra skill folder path…');
        fireEvent.change(input, { target: { value: '/opt/skills' } });
        fireEvent.click(screen.getByText('Add'));

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({ globalDisabledSkills: [], globalExtraFolders: ['/opt/skills'] }),
                }),
            );
        });
        const section = screen.getByTestId('skills-global-extra-folders');
        expect(within(section).getByText('/opt/skills')).toBeTruthy();
    });

    it('adds a global extra folder when Enter is pressed', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig())
            .mockResolvedValueOnce(undefined);
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Extra skill folder path…');
        fireEvent.change(input, { target: { value: '~/my/skills' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({ globalDisabledSkills: [], globalExtraFolders: ['~/my/skills'] }),
                }),
            );
        });
    });

    it('removes a global extra folder', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig({ globalExtraFolders: ['/keep', '/drop'] }))
            .mockResolvedValueOnce(undefined);
        render(<SkillsConfigPanel />);

        const section = await screen.findByTestId('skills-global-extra-folders');
        await waitFor(() => {
            expect(within(section).getByText('/keep')).toBeTruthy();
            expect(within(section).getByText('/drop')).toBeTruthy();
        });

        const removeBtns = within(section).getAllByTitle('Remove folder');
        fireEvent.click(removeBtns[1]); // remove "/drop"

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    body: JSON.stringify({ globalDisabledSkills: [], globalExtraFolders: ['/keep'] }),
                }),
            );
        });
        expect(within(section).queryByText('/drop')).toBeNull();
    });

    it('does not add a duplicate global extra folder', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({ globalExtraFolders: ['/opt/skills'] }));
        render(<SkillsConfigPanel />);

        const input = await screen.findByPlaceholderText('Extra skill folder path…');
        fireEvent.change(input, { target: { value: '/opt/skills' } });
        fireEvent.click(screen.getByText('Add'));

        // Only the initial GET should have been called (no PUT for the dup)
        expect(mockFetchApi).toHaveBeenCalledTimes(1);
    });

    // ── Auto-detect toggle (AC #4 / #5) ────────────────────────────────

    it('renders the auto-detect checkbox checked by default', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({ autoDetectDefaultFolders: true }));
        render(<SkillsConfigPanel />);

        const checkbox = await screen.findByLabelText('Auto-detect default skill folders') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });

    it('renders the auto-detect checkbox unchecked when disabled', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({ autoDetectDefaultFolders: false }));
        render(<SkillsConfigPanel />);

        const checkbox = await screen.findByLabelText('Auto-detect default skill folders') as HTMLInputElement;
        expect(checkbox.checked).toBe(false);
        expect(screen.getByText('Auto-detection is disabled.')).toBeTruthy();
    });

    it('persists autoDetectDefaultFolders when toggled off', async () => {
        mockFetchApi
            .mockResolvedValueOnce(makeConfig({ autoDetectDefaultFolders: true }))
            .mockResolvedValueOnce(undefined);
        render(<SkillsConfigPanel />);

        const checkbox = await screen.findByLabelText('Auto-detect default skill folders');
        fireEvent.click(checkbox);

        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                '/skills/config',
                expect.objectContaining({
                    method: 'PUT',
                    body: JSON.stringify({ globalDisabledSkills: [], autoDetectDefaultFolders: false }),
                }),
            );
        });
    });

    // ── Detected skill folders (AC #5 / #7) ────────────────────────────

    it('shows "No OneDrive skill folders detected." when none are auto-detected', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig());
        mockGetEffectivePaths.mockResolvedValueOnce({
            paths: [
                { source: 'managed-global', scope: 'global', status: 'available', path: '/home/u/.coc/skills', skillCount: 2 },
            ],
        });
        render(<SkillsConfigPanel />);

        const section = await screen.findByTestId('skills-detected-folders');
        await waitFor(() => {
            expect(within(section).getByText('No OneDrive skill folders detected.')).toBeTruthy();
        });
    });

    it('renders a detected auto-detected folder with skill count', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig());
        mockGetEffectivePaths.mockResolvedValueOnce({
            paths: [
                { source: 'auto-detected', scope: 'global', status: 'available', path: '/home/u/OneDrive/.github/skills', skillCount: 3 },
            ],
        });
        render(<SkillsConfigPanel />);

        const section = await screen.findByTestId('skills-detected-folders');
        await waitFor(() => {
            expect(within(section).getByText('/home/u/OneDrive/.github/skills')).toBeTruthy();
            expect(within(section).getByText('3 skills')).toBeTruthy();
        });
        // No loud "not detected" message when a folder is present.
        expect(within(section).queryByText('No OneDrive skill folders detected.')).toBeNull();
    });

    it('shows skipped OneDrive roots only in collapsed diagnostics (AC #7)', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig());
        mockGetEffectivePaths.mockResolvedValueOnce({
            paths: [
                {
                    source: 'auto-detected',
                    scope: 'global',
                    status: 'skipped',
                    path: '/home/u/OneDrive',
                    note: 'OneDrive root exists but has no .github/skills folder',
                },
            ],
        });
        render(<SkillsConfigPanel />);

        const section = await screen.findByTestId('skills-detected-folders');
        await waitFor(() => {
            expect(within(section).getByText('Diagnostics (1 skipped)')).toBeTruthy();
        });
        expect(within(section).getByText('OneDrive root exists but has no .github/skills folder')).toBeTruthy();
        // A skipped root is not surfaced as "no folders detected".
        expect(within(section).queryByText('No OneDrive skill folders detected.')).toBeNull();
    });

    it('shows "Auto-detection is disabled." and no detected list when off', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig({ autoDetectDefaultFolders: false }));
        mockGetEffectivePaths.mockResolvedValueOnce({ paths: [] });
        render(<SkillsConfigPanel />);

        const section = await screen.findByTestId('skills-detected-folders');
        await waitFor(() => {
            expect(within(section).getByText('Auto-detection is disabled.')).toBeTruthy();
        });
        expect(within(section).queryByText('No OneDrive skill folders detected.')).toBeNull();
    });

    // ── Effective search order (AC #6) ─────────────────────────────────

    it('renders the effective search order with source and status badges', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig());
        mockGetEffectivePaths.mockResolvedValueOnce({
            paths: [
                { source: 'managed-global', scope: 'global', status: 'available', path: '/home/u/.coc/skills', skillCount: 4 },
                { source: 'configured', scope: 'global', status: 'missing', path: '/opt/team/skills' },
                { source: 'bundled', scope: 'global', status: 'no-skills', path: '/app/bundled/skills', skillCount: 0 },
            ],
        });
        render(<SkillsConfigPanel />);

        const section = await screen.findByTestId('skills-effective-search-order');
        await waitFor(() => {
            expect(within(section).getByText('/home/u/.coc/skills')).toBeTruthy();
        });
        // Source badges
        expect(within(section).getByText('Managed')).toBeTruthy();
        expect(within(section).getByText('Configured')).toBeTruthy();
        expect(within(section).getByText('Bundled')).toBeTruthy();
        // Status badges
        expect(within(section).getByText('Available')).toBeTruthy();
        expect(within(section).getByText('Missing')).toBeTruthy();
        expect(within(section).getByText('No skills')).toBeTruthy();
        // Skill count
        expect(within(section).getByText('4 skills')).toBeTruthy();
    });

    it('shows a global-only note in the effective search order', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig());
        mockGetEffectivePaths.mockResolvedValueOnce({ paths: [] });
        render(<SkillsConfigPanel />);

        const section = await screen.findByTestId('skills-effective-search-order');
        await waitFor(() => {
            expect(within(section).getByText(/Showing global paths only/i)).toBeTruthy();
        });
    });

    it('shows "No effective skill paths." when the list is empty', async () => {
        mockFetchApi.mockResolvedValueOnce(makeConfig());
        mockGetEffectivePaths.mockResolvedValueOnce({ paths: [] });
        render(<SkillsConfigPanel />);

        const section = await screen.findByTestId('skills-effective-search-order');
        await waitFor(() => {
            expect(within(section).getByText('No effective skill paths.')).toBeTruthy();
        });
    });
});
