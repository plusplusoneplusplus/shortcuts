/**
 * Tests for SkillPicker — searchable popover skill picker with repo/global grouping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SkillPicker } from '../../../src/server/spa/client/react/queue/SkillPicker';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

const repoSkills = [
    { name: 'code-review', description: 'Review code changes', source: 'project' },
    { name: 'impl', description: 'Implement code changes with tests', source: 'project' },
    { name: 'draft', description: 'Draft a UX spec', source: 'project' },
];

const globalSkills = [
    { name: 'docx', description: 'Create Word documents', source: 'custom' },
    { name: 'humanizer', description: 'Remove AI writing signs', source: 'global' },
];

const allSkills = [...repoSkills, ...globalSkills];

function renderPicker(props: Partial<Parameters<typeof SkillPicker>[0]> = {}) {
    const onSkillChange = props.onSkillChange ?? vi.fn();
    return {
        onSkillChange,
        ...render(
            <SkillPicker
                skills={props.skills ?? allSkills}
                selectedSkills={props.selectedSkills ?? []}
                onSkillChange={onSkillChange}
            />
        ),
    };
}

describe('SkillPicker', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    // ── Rendering ──────────────────────────────────────────────────────────────

    describe('rendering', () => {
        it('renders the trigger button', () => {
            renderPicker();
            expect(screen.getByTestId('skill-picker-trigger')).toBeDefined();
            expect(screen.getByText('Add skill…')).toBeDefined();
        });

        it('renders the "Skills (optional)" label', () => {
            renderPicker();
            expect(screen.getByText('Skills (optional)')).toBeDefined();
        });

        it('does not render the popover by default', () => {
            renderPicker();
            expect(screen.queryByTestId('skill-picker-popover')).toBeNull();
        });

        it('renders selected skill chips', () => {
            renderPicker({ selectedSkills: ['impl', 'docx'] });
            expect(screen.getByTestId('skill-chip-impl')).toBeDefined();
            expect(screen.getByTestId('skill-chip-docx')).toBeDefined();
        });

        it('does not render a selected EnDev chip when the wrapper is unavailable', () => {
            renderPicker({ skills: repoSkills, selectedSkills: ['impl', 'EnDev-xDpu'] });
            expect(screen.getByTestId('skill-chip-impl')).toBeDefined();
            expect(screen.queryByTestId('skill-chip-EnDev-xDpu')).toBeNull();
        });

        it('selected chips have ✕ for removal', () => {
            renderPicker({ selectedSkills: ['impl'] });
            const chip = screen.getByTestId('skill-chip-impl');
            expect(chip.textContent).toContain('✕');
        });
    });

    // ── Popover open/close ─────────────────────────────────────────────────────

    describe('popover open/close', () => {
        it('opens popover on trigger click', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-popover')).toBeDefined();
        });

        it('closes popover on second trigger click', () => {
            renderPicker();
            const trigger = screen.getByTestId('skill-picker-trigger');
            fireEvent.click(trigger);
            expect(screen.getByTestId('skill-picker-popover')).toBeDefined();
            fireEvent.click(trigger);
            expect(screen.queryByTestId('skill-picker-popover')).toBeNull();
        });

        it('closes popover on outside click', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-popover')).toBeDefined();
            fireEvent.mouseDown(document.body);
            expect(screen.queryByTestId('skill-picker-popover')).toBeNull();
        });

        it('closes popover on Escape key', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            fireEvent.keyDown(searchInput, { key: 'Escape' });
            expect(screen.queryByTestId('skill-picker-popover')).toBeNull();
        });

        it('shows search input when popover is open', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-search')).toBeDefined();
            expect(screen.getByPlaceholderText('🔍 Search skills…')).toBeDefined();
        });
    });

    // ── Repo/Global grouping ───────────────────────────────────────────────────

    describe('repo/global grouping', () => {
        it('renders Repo section header', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-section-repo')).toBeDefined();
            expect(screen.getByText('Repo')).toBeDefined();
        });

        it('renders Global section header', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-section-global')).toBeDefined();
            expect(screen.getByText('Global')).toBeDefined();
        });

        it('lists repo skills under Repo section', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-item-code-review')).toBeDefined();
            expect(screen.getByTestId('skill-picker-item-impl')).toBeDefined();
            expect(screen.getByTestId('skill-picker-item-draft')).toBeDefined();
        });

        it('lists global skills under Global section', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-item-docx')).toBeDefined();
            expect(screen.getByTestId('skill-picker-item-humanizer')).toBeDefined();
        });

        it('does not render Repo section when all skills are global', () => {
            renderPicker({ skills: globalSkills });
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.queryByTestId('skill-picker-section-repo')).toBeNull();
            expect(screen.getByTestId('skill-picker-section-global')).toBeDefined();
        });

        it('does not render Global section when all skills are repo-sourced', () => {
            renderPicker({ skills: repoSkills });
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-section-repo')).toBeDefined();
            expect(screen.queryByTestId('skill-picker-section-global')).toBeNull();
        });
    });

    // ── Search / Filtering ─────────────────────────────────────────────────────

    describe('search filtering', () => {
        it('filters skills by name', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            fireEvent.change(searchInput, { target: { value: 'review' } });
            expect(screen.getByTestId('skill-picker-item-code-review')).toBeDefined();
            expect(screen.queryByTestId('skill-picker-item-impl')).toBeNull();
            expect(screen.queryByTestId('skill-picker-item-draft')).toBeNull();
        });

        it('filters skills by description', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            fireEvent.change(searchInput, { target: { value: 'Word' } });
            expect(screen.getByTestId('skill-picker-item-docx')).toBeDefined();
            expect(screen.queryByTestId('skill-picker-item-impl')).toBeNull();
        });

        it('search is case-insensitive', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            fireEvent.change(searchInput, { target: { value: 'IMPL' } });
            expect(screen.getByTestId('skill-picker-item-impl')).toBeDefined();
        });

        it('shows "No skills match" when search has no results', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            fireEvent.change(searchInput, { target: { value: 'zzzznonexistent' } });
            expect(screen.getByTestId('skill-picker-no-results')).toBeDefined();
            expect(screen.getByText('No skills match')).toBeDefined();
        });

        it('hides section headers when no skills match in that section', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            // "docx" only matches a global skill
            fireEvent.change(searchInput, { target: { value: 'docx' } });
            expect(screen.queryByTestId('skill-picker-section-repo')).toBeNull();
            expect(screen.getByTestId('skill-picker-section-global')).toBeDefined();
        });

        it('resets search when popover closes and reopens', () => {
            renderPicker();
            const trigger = screen.getByTestId('skill-picker-trigger');
            fireEvent.click(trigger);
            fireEvent.change(screen.getByTestId('skill-picker-search'), { target: { value: 'code' } });
            // Close
            fireEvent.click(trigger);
            // Reopen
            fireEvent.click(trigger);
            const searchInput = screen.getByTestId('skill-picker-search') as HTMLInputElement;
            expect(searchInput.value).toBe('');
        });
    });

    // ── Selection ──────────────────────────────────────────────────────────────

    describe('selection', () => {
        it('calls onSkillChange when a skill row is clicked', () => {
            const { onSkillChange } = renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            fireEvent.click(screen.getByTestId('skill-picker-item-impl'));
            expect(onSkillChange).toHaveBeenCalledWith('impl');
        });

        it('shows checkmark on selected skills in popover', () => {
            renderPicker({ selectedSkills: ['impl'] });
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-check-impl')).toBeDefined();
        });

        it('does not show checkmark on unselected skills', () => {
            renderPicker({ selectedSkills: ['impl'] });
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.queryByTestId('skill-picker-check-code-review')).toBeNull();
        });

        it('calls onSkillChange when a selected chip ✕ is clicked', () => {
            const { onSkillChange } = renderPicker({ selectedSkills: ['impl'] });
            fireEvent.click(screen.getByTestId('skill-chip-impl'));
            expect(onSkillChange).toHaveBeenCalledWith('impl');
        });

        it('popover stays open after selecting a skill (multi-select)', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            fireEvent.click(screen.getByTestId('skill-picker-item-impl'));
            // Popover should remain open
            expect(screen.getByTestId('skill-picker-popover')).toBeDefined();
        });
    });

    // ── Keyboard navigation ────────────────────────────────────────────────────

    describe('keyboard navigation', () => {
        it('ArrowDown moves highlight down', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            // First item is highlighted by default; press down to go to second
            fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
            // Now press Enter to select the second item (impl)
            fireEvent.keyDown(searchInput, { key: 'Enter' });
            // The skill-picker-item for 'impl' should have been selected
            // (first is code-review at index 0, impl at index 1)
        });

        it('ArrowUp moves highlight up', () => {
            renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            // Move down twice then up once
            fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
            fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
            fireEvent.keyDown(searchInput, { key: 'ArrowUp' });
            // Should be at index 1 (impl)
        });

        it('Enter selects highlighted skill', () => {
            const { onSkillChange } = renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            // Default highlight is index 0 = code-review
            fireEvent.keyDown(searchInput, { key: 'Enter' });
            expect(onSkillChange).toHaveBeenCalledWith('code-review');
        });

        it('Enter selects correct skill after ArrowDown', () => {
            const { onSkillChange } = renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
            fireEvent.keyDown(searchInput, { key: 'Enter' });
            expect(onSkillChange).toHaveBeenCalledWith('impl');
        });

        it('ArrowDown does not go past the last item', () => {
            const { onSkillChange } = renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            // Press down many times (more than total skills)
            for (let i = 0; i < 20; i++) {
                fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
            }
            fireEvent.keyDown(searchInput, { key: 'Enter' });
            // Should select the last skill (humanizer)
            expect(onSkillChange).toHaveBeenCalledWith('humanizer');
        });

        it('ArrowUp does not go above the first item', () => {
            const { onSkillChange } = renderPicker();
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            const searchInput = screen.getByTestId('skill-picker-search');
            // Press up multiple times from default index 0
            for (let i = 0; i < 5; i++) {
                fireEvent.keyDown(searchInput, { key: 'ArrowUp' });
            }
            fireEvent.keyDown(searchInput, { key: 'Enter' });
            // Should still be first skill (code-review)
            expect(onSkillChange).toHaveBeenCalledWith('code-review');
        });
    });

    // ── Edge cases ─────────────────────────────────────────────────────────────

    describe('edge cases', () => {
        it('works with a single skill', () => {
            const singleSkill = [{ name: 'only-one', description: 'The only skill', source: 'project' }];
            renderPicker({ skills: singleSkill });
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-item-only-one')).toBeDefined();
        });

        it('handles skills without descriptions', () => {
            const noDesc = [{ name: 'no-desc', source: 'project' }];
            renderPicker({ skills: noDesc });
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-item-no-desc')).toBeDefined();
        });

        it('handles skills without source (defaults to repo)', () => {
            const noSource = [{ name: 'no-source', description: 'Test' }];
            renderPicker({ skills: noSource });
            fireEvent.click(screen.getByTestId('skill-picker-trigger'));
            expect(screen.getByTestId('skill-picker-section-repo')).toBeDefined();
            expect(screen.getByTestId('skill-picker-item-no-source')).toBeDefined();
        });

        it('trigger button has tooltip', () => {
            renderPicker();
            const trigger = screen.getByTestId('skill-picker-trigger');
            expect(trigger.getAttribute('title')).toBe('Select skills to guide the AI');
        });
    });
});
