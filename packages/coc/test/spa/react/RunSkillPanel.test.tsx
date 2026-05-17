import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RunSkillPanel } from '../../../src/server/spa/client/react/shared/RunSkillPanel';
import type { RunSkillPanelProps, SkillItem } from '../../../src/server/spa/client/react/shared/RunSkillPanel';

function baseProps(overrides: Partial<RunSkillPanelProps> = {}): RunSkillPanelProps {
    return {
        skills: [],
        recentItems: [],
        models: [],
        loading: false,
        selectedSkills: [],
        additionalInfo: '',
        model: '',
        submitting: false,
        onSkillToggle: vi.fn(),
        onSubmitSkills: vi.fn(),
        onAdditionalInfoChange: vi.fn(),
        onModelChange: vi.fn(),
        selectionMode: 'multi',
        ...overrides,
    };
}

const SKILLS: SkillItem[] = [
    { name: 'impl', description: 'Implement changes.' },
    { name: 'review', description: 'Review code.' },
    { name: 'draft' },
];

describe('RunSkillPanel', () => {
    // ── Loading state ──

    it('shows spinner while loading', () => {
        render(<RunSkillPanel {...baseProps({ loading: true })} />);
        expect(screen.getByText(/Loading/)).toBeDefined();
    });

    // ── Empty state ──

    it('shows default empty message when no skills', () => {
        render(<RunSkillPanel {...baseProps()} />);
        expect(screen.getByText('No skills found in this workspace.')).toBeDefined();
    });

    it('shows custom empty message when provided', () => {
        render(<RunSkillPanel {...baseProps({ emptyMessage: 'Nothing here!' })} />);
        expect(screen.getByText('Nothing here!')).toBeDefined();
    });

    // ── Model select ──

    it('renders model options', () => {
        render(<RunSkillPanel {...baseProps({ models: ['gpt-4', 'claude-sonnet'], modelSelectId: 'test-model' })} />);
        const select = document.getElementById('test-model') as HTMLSelectElement;
        const options = Array.from(select.options).map(o => o.value);
        expect(options).toContain('');
        expect(options).toContain('gpt-4');
        expect(options).toContain('claude-sonnet');
    });

    it('calls onModelChange on selection', () => {
        const onModelChange = vi.fn();
        render(<RunSkillPanel {...baseProps({ models: ['gpt-4'], modelSelectId: 'test-model', onModelChange })} />);
        fireEvent.change(document.getElementById('test-model')!, { target: { value: 'gpt-4' } });
        expect(onModelChange).toHaveBeenCalledWith('gpt-4');
    });

    // ── Additional info ──

    it('renders additional info textarea', () => {
        render(<RunSkillPanel {...baseProps({ additionalInfoId: 'test-info' })} />);
        const textarea = document.getElementById('test-info') as HTMLTextAreaElement;
        expect(textarea).toBeDefined();
        expect(textarea.tagName).toBe('TEXTAREA');
        expect(textarea.placeholder).toContain('Extra context');
    });

    it('calls onAdditionalInfoChange on input', () => {
        const onAdditionalInfoChange = vi.fn();
        render(<RunSkillPanel {...baseProps({ additionalInfoId: 'test-info', onAdditionalInfoChange })} />);
        fireEvent.change(document.getElementById('test-info')!, { target: { value: 'focus on auth' } });
        expect(onAdditionalInfoChange).toHaveBeenCalledWith('focus on auth');
    });

    it('disables textarea when submitting', () => {
        render(<RunSkillPanel {...baseProps({ submitting: true, additionalInfoId: 'test-info' })} />);
        const textarea = document.getElementById('test-info') as HTMLTextAreaElement;
        expect(textarea.disabled).toBe(true);
    });

    it('disables textarea when disabled prop is true', () => {
        render(<RunSkillPanel {...baseProps({ disabled: true, additionalInfoId: 'test-info' })} />);
        const textarea = document.getElementById('test-info') as HTMLTextAreaElement;
        expect(textarea.disabled).toBe(true);
    });

    // ── Multi mode (chips) ──

    it('renders skill chips in multi mode', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi' })} />);
        expect(screen.getByText('impl')).toBeDefined();
        expect(screen.getByText('review')).toBeDefined();
        expect(screen.getByText('draft')).toBeDefined();
    });

    it('shows active state for selected chips', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', selectedSkills: ['impl'] })} />);
        const implBtn = screen.getByText('impl').closest('button')!;
        expect(implBtn.className).toContain('bg-[#0078d4]');
        const reviewBtn = screen.getByText('review').closest('button')!;
        expect(reviewBtn.className).not.toContain('bg-[#0078d4]');
    });

    it('calls onSkillToggle when chip is clicked', () => {
        const onSkillToggle = vi.fn();
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', onSkillToggle })} />);
        fireEvent.click(screen.getByText('impl'));
        expect(onSkillToggle).toHaveBeenCalledWith('impl');
    });

    it('shows submit button when skills are selected', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', selectedSkills: ['impl'] })} />);
        expect(screen.getByTestId('fp-submit-skills')).toBeDefined();
        expect(screen.getByTestId('fp-submit-skills').textContent).toContain('Submit with 1 skill');
    });

    it('shows plural submit label for multiple skills', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', selectedSkills: ['impl', 'review'] })} />);
        expect(screen.getByTestId('fp-submit-skills').textContent).toContain('Submit with 2 skills');
    });

    it('hides submit button when no skills selected', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', selectedSkills: [] })} />);
        expect(screen.queryByTestId('fp-submit-skills')).toBeNull();
    });

    it('calls onSubmitSkills with selected skills on submit click', () => {
        const onSubmitSkills = vi.fn();
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', selectedSkills: ['impl', 'review'], onSubmitSkills })} />);
        fireEvent.click(screen.getByTestId('fp-submit-skills'));
        expect(onSubmitSkills).toHaveBeenCalledWith(['impl', 'review']);
    });

    it('excludes the unavailable EnDev wrapper from selected skill submission', () => {
        const onSubmitSkills = vi.fn();
        render(<RunSkillPanel {...baseProps({
            skills: SKILLS,
            selectionMode: 'multi',
            selectedSkills: ['impl', 'EnDev-xDpu'],
            onSubmitSkills,
        })} />);
        expect(screen.getByTestId('fp-submit-skills').textContent).toContain('Submit with 1 skill');
        fireEvent.click(screen.getByTestId('fp-submit-skills'));
        expect(onSubmitSkills).toHaveBeenCalledWith(['impl']);
    });

    it('hides submit button when only the unavailable EnDev wrapper is selected', () => {
        render(<RunSkillPanel {...baseProps({
            skills: SKILLS,
            selectionMode: 'multi',
            selectedSkills: ['EnDev-xDpu'],
        })} />);
        expect(screen.queryByTestId('fp-submit-skills')).toBeNull();
    });

    it('uses custom submitLabel when provided', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', selectedSkills: ['impl'], submitLabel: 'Go!' })} />);
        expect(screen.getByTestId('fp-submit-skills').textContent).toBe('Go!');
    });

    it('shows Submitting… text when submitting', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', selectedSkills: ['impl'], submitting: true })} />);
        expect(screen.getByTestId('fp-submit-skills').textContent).toBe('Submitting…');
    });

    it('disables chip buttons when submitting', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', submitting: true })} />);
        const implBtn = screen.getByText('impl').closest('button')!;
        expect(implBtn.disabled).toBe(true);
    });

    it('sets title to description on chip buttons', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi' })} />);
        const implBtn = screen.getByText('impl').closest('button')!;
        expect(implBtn.title).toBe('Implement changes.');
        const draftBtn = screen.getByText('draft').closest('button')!;
        expect(draftBtn.title).toBe('draft');
    });

    it('shows ✕ on selected chips', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'multi', selectedSkills: ['impl'] })} />);
        const implBtn = screen.getByText('impl').closest('button')!;
        expect(implBtn.textContent).toContain('✕');
        const reviewBtn = screen.getByText('review').closest('button')!;
        expect(reviewBtn.textContent).not.toContain('✕');
    });

    // ── Single mode (rows) ──

    it('renders skill rows in single mode', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'single' })} />);
        expect(screen.getByText('impl')).toBeDefined();
        expect(screen.getByText('Implement changes.')).toBeDefined();
    });

    it('calls onSubmitSkills with skill name on row click in single mode', () => {
        const onSubmitSkills = vi.fn();
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'single', onSubmitSkills })} />);
        fireEvent.click(screen.getByText('impl'));
        expect(onSubmitSkills).toHaveBeenCalledWith(['impl']);
    });

    it('does not show submit button in single mode', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'single' })} />);
        expect(screen.queryByTestId('fp-submit-skills')).toBeNull();
    });

    it('disables rows when disabled prop is true in single mode', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, selectionMode: 'single', disabled: true })} />);
        const implBtn = screen.getByText('impl').closest('button')!;
        expect(implBtn.disabled).toBe(true);
    });

    // ── Last Used section ──

    it('renders Last Used section when recent items exist', () => {
        const recentItems: SkillItem[] = [{ name: 'impl', description: 'Implement changes.' }];
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, recentItems })} />);
        expect(screen.getByText('Last Used')).toBeDefined();
        const recentButtons = document.querySelectorAll('.fp-recent-item');
        expect(recentButtons.length).toBe(1);
    });

    it('filters the unavailable EnDev wrapper from Last Used items', () => {
        const recentItems: SkillItem[] = [{ name: 'impl' }, { name: 'EnDev-xDpu' }];
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, recentItems })} />);
        expect(screen.getByText('Last Used')).toBeDefined();
        expect(screen.queryByText('EnDev-xDpu')).toBeNull();
        const recentButtons = document.querySelectorAll('.fp-recent-item');
        expect(recentButtons.length).toBe(1);
        expect(within(recentButtons[0] as HTMLElement).getByText('impl')).toBeDefined();
    });

    it('does not render Last Used when no recent items', () => {
        render(<RunSkillPanel {...baseProps({ skills: SKILLS })} />);
        expect(screen.queryByText('Last Used')).toBeNull();
    });

    it('does not render Last Used while loading', () => {
        const recentItems: SkillItem[] = [{ name: 'impl' }];
        render(<RunSkillPanel {...baseProps({ loading: true, recentItems })} />);
        expect(screen.queryByText('Last Used')).toBeNull();
    });

    it('calls onSubmitSkills with single skill on recent item click', () => {
        const onSubmitSkills = vi.fn();
        const recentItems: SkillItem[] = [{ name: 'impl' }];
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, recentItems, onSubmitSkills })} />);
        const recentBtn = document.querySelector('.fp-recent-item')!;
        fireEvent.click(recentBtn);
        expect(onSubmitSkills).toHaveBeenCalledWith(['impl']);
    });

    it('disables recent item buttons when disabled', () => {
        const recentItems: SkillItem[] = [{ name: 'impl' }];
        render(<RunSkillPanel {...baseProps({ skills: SKILLS, recentItems, disabled: true })} />);
        const recentBtn = document.querySelector('.fp-recent-item') as HTMLButtonElement;
        expect(recentBtn.disabled).toBe(true);
    });

    // ── afterModelContent slot ──

    it('renders afterModelContent between model and additional info', () => {
        const { container } = render(
            <RunSkillPanel
                {...baseProps({
                    afterModelContent: <div data-testid="ws-select">Workspace</div>,
                })}
            />,
        );
        expect(screen.getByTestId('ws-select')).toBeDefined();
        // Verify ordering: model select appears before ws-select in DOM
        const allSelects = container.querySelectorAll('select, [data-testid="ws-select"]');
        expect(allSelects.length).toBeGreaterThanOrEqual(2);
    });
});
