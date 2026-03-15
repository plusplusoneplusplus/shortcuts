/**
 * Tests for SkillsView component.
 *
 * SkillsView uses useApp (AppContext) for the active sub-tab state.
 * We mock AppContext so the component renders without real state management.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SkillsView } from '../../../../../src/server/spa/client/react/views/skills/SkillsView';

// SkillsInstalledPanel and siblings make fetch calls — mock fetchApi to silence them
vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({ skills: [] }),
}));

const mockDispatch = vi.fn();
const makeAppState = (activeSkillsSubTab = 'installed') => ({
    state: { activeSkillsSubTab },
    dispatch: mockDispatch,
});

vi.mock('../../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: vi.fn(() => makeAppState()),
}));

import { useApp } from '../../../../../src/server/spa/client/react/context/AppContext';

afterEach(() => {
    vi.clearAllMocks();
});

describe('SkillsView', () => {
    it('renders the sub-tab bar with Installed, Bundled, Config tabs', () => {
        render(<SkillsView />);
        expect(screen.getByText('Installed')).toBeTruthy();
        expect(screen.getByText('Bundled')).toBeTruthy();
        expect(screen.getByText('Config')).toBeTruthy();
    });

    it('renders SkillsInstalledPanel by default (installed tab)', () => {
        (useApp as ReturnType<typeof vi.fn>).mockReturnValue(makeAppState('installed'));
        render(<SkillsView />);
        // SkillsInstalledPanel renders loading state initially
        expect(screen.getByText('Loading global skills…')).toBeTruthy();
    });

    it('dispatches SET_SKILLS_SUB_TAB when Bundled tab is clicked', () => {
        (useApp as ReturnType<typeof vi.fn>).mockReturnValue(makeAppState('installed'));
        render(<SkillsView />);
        const bundledBtn = screen.getAllByRole('button').find(b => b.textContent === 'Bundled');
        fireEvent.click(bundledBtn!);
        expect(mockDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SET_SKILLS_SUB_TAB', tab: 'bundled' })
        );
    });

    it('dispatches SET_SKILLS_SUB_TAB when Config tab is clicked', () => {
        render(<SkillsView />);
        const configBtn = screen.getAllByRole('button').find(b => b.textContent === 'Config');
        fireEvent.click(configBtn!);
        expect(mockDispatch).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SET_SKILLS_SUB_TAB', tab: 'config' })
        );
    });

    it('active tab button has highlighted border-b class', () => {
        (useApp as ReturnType<typeof vi.fn>).mockReturnValue(makeAppState('bundled'));
        render(<SkillsView />);
        const bundledBtn = screen.getAllByRole('button').find(b => b.textContent === 'Bundled')!;
        expect(bundledBtn.className).toContain('border-[#0078d4]');
    });
});
