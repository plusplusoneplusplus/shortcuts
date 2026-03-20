/**
 * Tests for shared SkillListItem — skill card row with toggle, delete, expand, and detail panel.
 * Regression coverage to ensure the shared component works for both AgentSkillsPanel and SkillsInstalledPanel.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SkillListItem } from '../../../../src/server/spa/client/react/shared/SkillListItem';
import type { SkillListItemProps } from '../../../../src/server/spa/client/react/shared/SkillListItem';
import type { SkillInfo } from '../../../../src/server/spa/client/react/shared/SkillDetailPanel';

const baseSkill: SkillInfo = { name: 'test-skill', description: 'A test skill', version: '1.0.0' };

function renderItem(overrides: Partial<SkillListItemProps> = {}) {
    const props: SkillListItemProps = {
        skill: baseSkill,
        isExpanded: false,
        isEnabled: true,
        detail: null,
        detailLoading: false,
        deleteConfirm: false,
        onExpand: vi.fn(),
        onToggle: vi.fn(),
        onDelete: vi.fn(),
        onSetDeleteConfirm: vi.fn(),
        ...overrides,
    };
    const result = render(<SkillListItem {...props} />);
    return { ...result, ...props };
}

describe('SkillListItem (shared)', () => {
    it('renders skill name with 🧩 emoji', () => {
        renderItem();
        const item = screen.getByTestId('skill-item-test-skill');
        expect(item.textContent).toContain('🧩');
        expect(item.textContent).toContain('test-skill');
    });

    it('renders version badge when present', () => {
        renderItem();
        expect(screen.getByTestId('skill-item-test-skill').textContent).toContain('v1.0.0');
    });

    it('does not render version badge when absent', () => {
        renderItem({ skill: { name: 'plain-skill' } });
        const item = screen.getByTestId('skill-item-plain-skill');
        expect(item.textContent).not.toContain('v1.0.0');
    });

    it('shows description when present', () => {
        renderItem();
        expect(screen.getByText('A test skill')).toBeTruthy();
    });

    it('does not show description when absent', () => {
        renderItem({ skill: { name: 'no-desc' } });
        expect(screen.queryByText('A test skill')).toBeNull();
    });

    it('shows collapsed chevron ▸ when not expanded', () => {
        renderItem({ isExpanded: false });
        expect(screen.getByTestId('skill-item-test-skill').textContent).toContain('▸');
    });

    it('shows expanded chevron ▾ when expanded', () => {
        renderItem({ isExpanded: true, detail: baseSkill });
        expect(screen.getByTestId('skill-item-test-skill').textContent).toContain('▾');
    });

    it('calls onExpand when content area is clicked', () => {
        const { onExpand } = renderItem();
        fireEvent.click(screen.getByTestId('skill-expand-test-skill'));
        expect(onExpand).toHaveBeenCalledTimes(1);
    });

    it('renders toggle in checked state when enabled', () => {
        renderItem({ isEnabled: true });
        const toggle = screen.getByTestId('skill-toggle-test-skill') as HTMLInputElement;
        expect(toggle.checked).toBe(true);
    });

    it('renders toggle in unchecked state when disabled', () => {
        renderItem({ isEnabled: false });
        const toggle = screen.getByTestId('skill-toggle-test-skill') as HTMLInputElement;
        expect(toggle.checked).toBe(false);
    });

    it('calls onToggle when toggle is changed', () => {
        const { onToggle } = renderItem({ isEnabled: false });
        fireEvent.click(screen.getByTestId('skill-toggle-test-skill'));
        expect(onToggle).toHaveBeenCalledWith(true);
    });

    it('toggle is disabled when toggleDisabled is true', () => {
        renderItem({ toggleDisabled: true });
        const toggle = screen.getByTestId('skill-toggle-test-skill') as HTMLInputElement;
        expect(toggle.disabled).toBe(true);
    });

    it('shows delete button by default (opacity-0 class)', () => {
        renderItem();
        const btn = screen.getByTestId('skill-delete-btn-test-skill');
        expect(btn).toBeTruthy();
        expect(btn.className).toContain('opacity-0');
    });

    describe('two-step delete', () => {
        it('clicking 🗑 calls onSetDeleteConfirm(true)', () => {
            const { onSetDeleteConfirm } = renderItem();
            fireEvent.click(screen.getByTestId('skill-delete-btn-test-skill'));
            expect(onSetDeleteConfirm).toHaveBeenCalledWith(true);
        });

        it('shows "Delete? Yes/No" when deleteConfirm is true', () => {
            renderItem({ deleteConfirm: true });
            expect(screen.getByText('Delete?')).toBeTruthy();
            expect(screen.getByTestId('skill-delete-confirm-test-skill')).toBeTruthy();
            expect(screen.getByText('No')).toBeTruthy();
        });

        it('clicking Yes calls onDelete', () => {
            const { onDelete } = renderItem({ deleteConfirm: true });
            fireEvent.click(screen.getByTestId('skill-delete-confirm-test-skill'));
            expect(onDelete).toHaveBeenCalledTimes(1);
        });

        it('clicking No calls onSetDeleteConfirm(false)', () => {
            const { onSetDeleteConfirm } = renderItem({ deleteConfirm: true });
            fireEvent.click(screen.getByText('No'));
            expect(onSetDeleteConfirm).toHaveBeenCalledWith(false);
        });
    });

    it('renders SkillDetailPanel when expanded', () => {
        renderItem({ isExpanded: true, detail: baseSkill, detailLoading: false });
        expect(screen.getByTestId('skill-detail-panel')).toBeTruthy();
    });

    it('shows loading state in detail panel when expanded and loading', () => {
        renderItem({ isExpanded: true, detail: null, detailLoading: true });
        expect(screen.getByTestId('skill-detail-loading')).toBeTruthy();
    });

    it('does not render detail panel when collapsed', () => {
        renderItem({ isExpanded: false, detail: baseSkill });
        expect(screen.queryByTestId('skill-detail-panel')).toBeNull();
    });

    it('applies opacity-60 when skill is disabled', () => {
        renderItem({ isEnabled: false });
        const item = screen.getByTestId('skill-item-test-skill');
        expect(item.className).toContain('opacity-60');
    });

    it('does not apply opacity-60 when skill is enabled', () => {
        renderItem({ isEnabled: true });
        const item = screen.getByTestId('skill-item-test-skill');
        expect(item.className).not.toContain('opacity-60');
    });

    it('uses testIdPrefix for all data-testid attributes', () => {
        renderItem({ testIdPrefix: 'custom' });
        expect(screen.getByTestId('custom-item-test-skill')).toBeTruthy();
        expect(screen.getByTestId('custom-expand-test-skill')).toBeTruthy();
        expect(screen.getByTestId('custom-toggle-test-skill')).toBeTruthy();
        expect(screen.getByTestId('custom-delete-btn-test-skill')).toBeTruthy();
    });

    it('toggle click does not trigger onExpand', () => {
        const { onExpand } = renderItem();
        fireEvent.click(screen.getByTestId('skill-toggle-test-skill'));
        expect(onExpand).not.toHaveBeenCalled();
    });

    it('delete button click does not trigger onExpand', () => {
        const { onExpand } = renderItem();
        fireEvent.click(screen.getByTestId('skill-delete-btn-test-skill'));
        expect(onExpand).not.toHaveBeenCalled();
    });
});
