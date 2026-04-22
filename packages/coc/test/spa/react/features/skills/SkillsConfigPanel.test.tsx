/**
 * Tests for SkillsConfigPanel component.
 *
 * Covers: initial load, global directory display, disabled-skills badges,
 * add/remove disabled skill, duplicate prevention, Enter-key support,
 * empty state, and error handling.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SkillsConfigPanel } from '../../../../../src/server/spa/client/react/features/skills/SkillsConfigPanel';

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

import { fetchApi } from '../../../../../src/server/spa/client/react/hooks/useApi';

const mockFetchApi = fetchApi as ReturnType<typeof vi.fn>;

afterEach(() => {
    vi.clearAllMocks();
});

const makeConfig = (overrides: Record<string, any> = {}) => ({
    globalDisabledSkills: [],
    globalSkillsDir: '',
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
});
