/**
 * Tests for ResolveContextDialog component.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';
import { ResolveContextDialog, shouldSkipResolveDialog, resetSkipResolveDialog } from '../../../../src/server/spa/client/react/shared/ResolveContextDialog';

// Mock useSlashCommands
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => ({
        menuVisible: false,
        menuFilter: '',
        filteredSkills: [],
        highlightIndex: 0,
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn().mockReturnValue(false),
        selectSkill: vi.fn(),
        parseAndExtract: vi.fn((text: string) => ({ skills: [], prompt: text })),
        dismissMenu: vi.fn(),
    }),
}));

// Mock SlashCommandMenu
vi.mock('../../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
    META_SKILL_ITEMS: [],
}));

// Mock fetchApi for skills
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn((..._args: any[]) => Promise.resolve({ merged: [] })),
}));

// Mock useBreakpoint (required by Dialog)
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

describe('ResolveContextDialog', () => {
    let onClose: ReturnType<typeof vi.fn>;
    let onSubmit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        onClose = vi.fn();
        onSubmit = vi.fn();
        sessionStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function renderDialog(overrides: Partial<React.ComponentProps<typeof ResolveContextDialog>> = {}) {
        return render(
            <ResolveContextDialog
                open={true}
                onClose={onClose}
                onSubmit={onSubmit}
                commentCount={3}
                wsId="ws-1"
                {...overrides}
            />
        );
    }

    it('renders with title and comment count', () => {
        renderDialog();
        expect(screen.getByText('Resolve with AI')).toBeTruthy();
        expect(screen.getByTestId('resolve-dialog-info').textContent).toContain('3 open comments');
    });

    it('renders custom title', () => {
        renderDialog({ title: 'Fix with AI' });
        expect(screen.getByText('Fix with AI')).toBeTruthy();
    });

    it('shows singular "comment" for count of 1', () => {
        renderDialog({ commentCount: 1 });
        expect(screen.getByTestId('resolve-dialog-info').textContent).toContain('1 open comment');
        expect(screen.getByTestId('resolve-dialog-info').textContent).not.toContain('comments');
    });

    it('calls onClose when cancel is clicked', () => {
        renderDialog();
        fireEvent.click(screen.getByTestId('resolve-dialog-cancel'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onSubmit with empty context and no skills when submitted empty', () => {
        renderDialog();
        fireEvent.click(screen.getByTestId('resolve-dialog-submit'));
        expect(onSubmit).toHaveBeenCalledWith('', []);
    });

    it('does not render when open is false', () => {
        renderDialog({ open: false });
        expect(screen.queryByTestId('resolve-dialog-submit')).toBeNull();
    });

    it('renders the input field with placeholder', () => {
        renderDialog();
        expect(screen.getByTestId('resolve-dialog-input')).toBeTruthy();
    });

    it('renders the "Don\'t ask again" checkbox', () => {
        renderDialog();
        const checkbox = screen.getByTestId('resolve-dialog-skip-checkbox') as HTMLInputElement;
        expect(checkbox).toBeTruthy();
        expect(checkbox.checked).toBe(false);
    });

    it('stores skip preference in sessionStorage when checkbox is checked and submitted', () => {
        renderDialog();
        const checkbox = screen.getByTestId('resolve-dialog-skip-checkbox') as HTMLInputElement;
        fireEvent.click(checkbox);
        expect(checkbox.checked).toBe(true);
        fireEvent.click(screen.getByTestId('resolve-dialog-submit'));
        expect(sessionStorage.getItem('coc:skipResolveDialog')).toBe('1');
    });

    it('does not store skip preference when checkbox is unchecked', () => {
        renderDialog();
        fireEvent.click(screen.getByTestId('resolve-dialog-submit'));
        expect(sessionStorage.getItem('coc:skipResolveDialog')).toBeNull();
    });
});

describe('shouldSkipResolveDialog', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('returns false when no preference is set', () => {
        expect(shouldSkipResolveDialog()).toBe(false);
    });

    it('returns true when preference is set', () => {
        sessionStorage.setItem('coc:skipResolveDialog', '1');
        expect(shouldSkipResolveDialog()).toBe(true);
    });

    it('returns false after resetSkipResolveDialog', () => {
        sessionStorage.setItem('coc:skipResolveDialog', '1');
        resetSkipResolveDialog();
        expect(shouldSkipResolveDialog()).toBe(false);
    });
});
