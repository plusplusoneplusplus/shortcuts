/**
 * Tests for CustomInstructionsPanel — active instruction tabs, 50 KB limit, save/delete per mode.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    CustomInstructionsPanel,
    INSTRUCTION_MODES,
    INSTRUCTION_MODE_LABELS,
    MAX_INSTRUCTION_BYTES,
} from '../../../../src/server/spa/client/react/features/skills/CustomInstructionsPanel';
import type { InstructionMode } from '../../../../src/server/spa/client/react/features/skills/CustomInstructionsPanel';

const emptyDraft: Record<InstructionMode, string> = { base: '', ask: '', autopilot: '' };
const emptyContents: Record<InstructionMode, string | null> = { base: null, ask: null, autopilot: null };

function renderPanel(overrides: Partial<Parameters<typeof CustomInstructionsPanel>[0]> = {}) {
    const onDraftChange = vi.fn();
    const onSave = vi.fn();
    const onDelete = vi.fn();
    const result = render(
        <CustomInstructionsPanel
            instrLoading={false}
            instrContents={emptyContents}
            instrDraft={emptyDraft}
            instrSaving={false}
            onDraftChange={onDraftChange}
            onSave={onSave}
            onDelete={onDelete}
            {...overrides}
        />
    );
    return { ...result, onDraftChange, onSave, onDelete };
}

describe('CustomInstructionsPanel — tabs', () => {
    it('renders active instruction tabs without Plan', () => {
        renderPanel();
        for (const mode of INSTRUCTION_MODES) {
            expect(screen.getByTestId(`instr-tab-${mode}`)).toBeTruthy();
        }
        expect(screen.queryByTestId('instr-tab-plan')).toBeNull();
    });

    it('shows correct label for each tab', () => {
        renderPanel();
        for (const mode of INSTRUCTION_MODES) {
            expect(screen.getByText(INSTRUCTION_MODE_LABELS[mode])).toBeTruthy();
        }
    });

    it('switching to a tab makes that tab active (textarea becomes visible)', async () => {
        const user = userEvent.setup();
        renderPanel();
        await user.click(screen.getByTestId('instr-tab-ask'));
        expect(screen.getByTestId('instr-textarea-ask')).toBeTruthy();
    });
});

describe('CustomInstructionsPanel — save / delete', () => {
    it('calls onSave with active mode when Save is clicked', async () => {
        const user = userEvent.setup();
        const { onSave } = renderPanel();
        await user.click(screen.getByTestId('instr-save-base'));
        expect(onSave).toHaveBeenCalledWith('base');
    });

    it('calls onSave with selected mode after switching tabs', async () => {
        const user = userEvent.setup();
        const { onSave } = renderPanel();
        await user.click(screen.getByTestId('instr-tab-autopilot'));
        await user.click(screen.getByTestId('instr-save-autopilot'));
        expect(onSave).toHaveBeenCalledWith('autopilot');
    });

    it('shows delete button when mode has existing content', () => {
        renderPanel({ instrContents: { ...emptyContents, base: 'existing content' } });
        expect(screen.getByTestId('instr-delete-base')).toBeTruthy();
    });

    it('does not show delete button when mode content is null', () => {
        renderPanel();
        expect(screen.queryByTestId('instr-delete-base')).toBeNull();
    });

    it('calls onDelete with active mode when Delete is clicked', async () => {
        const user = userEvent.setup();
        const { onDelete } = renderPanel({
            instrContents: { ...emptyContents, base: 'something' },
        });
        await user.click(screen.getByTestId('instr-delete-base'));
        expect(onDelete).toHaveBeenCalledWith('base');
    });
});

describe('CustomInstructionsPanel — existing content display', () => {
    it('shows draft content in textarea', () => {
        renderPanel({ instrDraft: { ...emptyDraft, base: 'my instructions' } });
        expect(screen.getByDisplayValue('my instructions')).toBeTruthy();
    });
});

describe('CustomInstructionsPanel — byte limit warning', () => {
    it('shows byte-count warning when draft exceeds 80% of MAX_INSTRUCTION_BYTES', () => {
        const bigDraft = 'x'.repeat(Math.floor(MAX_INSTRUCTION_BYTES * 0.85));
        renderPanel({ instrDraft: { ...emptyDraft, base: bigDraft } });
        expect(screen.getByText(/bytes/)).toBeTruthy();
    });

    it('does not show byte warning for short drafts', () => {
        renderPanel({ instrDraft: { ...emptyDraft, base: 'short' } });
        expect(screen.queryByText(/bytes/)).toBeNull();
    });

    it('shows "exceeds limit" message when draft is over MAX_INSTRUCTION_BYTES', () => {
        const overLimitDraft = 'x'.repeat(MAX_INSTRUCTION_BYTES + 100);
        renderPanel({ instrDraft: { ...emptyDraft, base: overLimitDraft } });
        expect(screen.getByText(/exceeds limit/)).toBeTruthy();
    });
});

describe('CustomInstructionsPanel — loading state', () => {
    it('shows loading indicator when instrLoading is true', () => {
        renderPanel({ instrLoading: true });
        expect(screen.getByText(/loading/i)).toBeTruthy();
    });
});
