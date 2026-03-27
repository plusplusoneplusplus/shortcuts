/**
 * Tests for SkillsInstalledPanel component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SkillsInstalledPanel } from '../../../../../src/server/spa/client/react/views/skills/SkillsInstalledPanel';

// Mock fetchApi so tests don't make real HTTP calls
vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(),
}));

import { fetchApi } from '../../../../../src/server/spa/client/react/hooks/useApi';

afterEach(() => {
    vi.clearAllMocks();
});

const makeSkill = (name: string, overrides: Record<string, any> = {}) => ({
    name,
    description: `${name} description`,
    version: '1.0.0',
    ...overrides,
});

describe('SkillsInstalledPanel', () => {
    it('shows loading state initially', () => {
        (fetchApi as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
        render(<SkillsInstalledPanel />);
        expect(screen.getByText('Loading global skills…')).toBeTruthy();
    });

    it('shows empty state when no skills installed', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ skills: [] }) // /skills
            .mockResolvedValueOnce({ globalDisabledSkills: [] }); // /skills/config
        render(<SkillsInstalledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-installed-empty')).toBeTruthy();
        });
    });

    it('renders each installed skill name', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ skills: [makeSkill('my-skill'), makeSkill('other-skill')] })
            .mockResolvedValueOnce({ globalDisabledSkills: [] });
        render(<SkillsInstalledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-installed-item-my-skill')).toBeTruthy();
            expect(screen.getByTestId('skills-installed-item-other-skill')).toBeTruthy();
        });
    });

    it('shows skill description when present', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ skills: [makeSkill('my-skill', { description: 'Does things' })] })
            .mockResolvedValueOnce({ globalDisabledSkills: [] });
        render(<SkillsInstalledPanel />);
        await waitFor(() => {
            expect(screen.getByText('Does things')).toBeTruthy();
        });
    });

    it('renders delete button for each skill', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ skills: [makeSkill('alpha')] })
            .mockResolvedValueOnce({ globalDisabledSkills: [] });
        render(<SkillsInstalledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-installed-delete-btn-alpha')).toBeTruthy();
        });
    });

    it('shows skill count text', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ skills: [makeSkill('s1'), makeSkill('s2')] })
            .mockResolvedValueOnce({ globalDisabledSkills: [] });
        render(<SkillsInstalledPanel />);
        await waitFor(() => {
            expect(screen.getByText('2 global skill(s) installed')).toBeTruthy();
        });
    });

    it('calls DELETE fetch when delete is confirmed via two-step inline delete', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ skills: [makeSkill('my-skill')] })
            .mockResolvedValueOnce({ globalDisabledSkills: [] })
            .mockResolvedValueOnce(undefined); // DELETE response
        render(<SkillsInstalledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-installed-delete-btn-my-skill')).toBeTruthy();
        });
        // Step 1: click delete button to show confirm
        fireEvent.click(screen.getByTestId('skills-installed-delete-btn-my-skill'));
        await waitFor(() => {
            expect(screen.getByTestId('skills-installed-delete-confirm-my-skill')).toBeTruthy();
        });
        // Step 2: click Yes to confirm delete
        fireEvent.click(screen.getByTestId('skills-installed-delete-confirm-my-skill'));
        await waitFor(() => {
            expect(fetchApi).toHaveBeenCalledWith(
                expect.stringContaining('/skills/my-skill'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });
    });

    it('does not call DELETE when delete is cancelled via No button', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ skills: [makeSkill('my-skill')] })
            .mockResolvedValueOnce({ globalDisabledSkills: [] });
        render(<SkillsInstalledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-installed-delete-btn-my-skill')).toBeTruthy();
        });
        // Step 1: click delete button to show confirm
        fireEvent.click(screen.getByTestId('skills-installed-delete-btn-my-skill'));
        await waitFor(() => {
            expect(screen.getByText('Delete?')).toBeTruthy();
        });
        // Step 2: click No to cancel
        fireEvent.click(screen.getByText('No'));
        // Should not have called DELETE — only initial loads (2 calls)
        expect(fetchApi).toHaveBeenCalledTimes(2);
        // Delete confirm prompt should be gone
        expect(screen.getByTestId('skills-installed-delete-btn-my-skill')).toBeTruthy();
    });

    it('renders refresh button', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ skills: [makeSkill('s1')] })
            .mockResolvedValueOnce({ globalDisabledSkills: [] });
        render(<SkillsInstalledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-installed-refresh-btn')).toBeTruthy();
        });
    });

    it('calls loadSkills and loadConfig when refresh button is clicked', async () => {
        (fetchApi as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({ skills: [makeSkill('s1')] })
            .mockResolvedValueOnce({ globalDisabledSkills: [] })
            .mockResolvedValueOnce({ skills: [makeSkill('s1'), makeSkill('s2')] })
            .mockResolvedValueOnce({ globalDisabledSkills: [] });
        render(<SkillsInstalledPanel />);
        await waitFor(() => {
            expect(screen.getByTestId('skills-installed-refresh-btn')).toBeTruthy();
        });
        const callsBefore = (fetchApi as ReturnType<typeof vi.fn>).mock.calls.length;
        fireEvent.click(screen.getByTestId('skills-installed-refresh-btn'));
        await waitFor(() => {
            expect((fetchApi as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });
});
