/**
 * CustomInstructionsPanel — Custom Instructions section extracted from RepoCopilotTab.
 */

import { useState } from 'react';
import { Button } from '../../ui';

export type InstructionMode = 'base' | 'ask' | 'autopilot';

export const INSTRUCTION_MODES: InstructionMode[] = ['base', 'ask', 'autopilot'];

export const INSTRUCTION_MODE_LABELS: Record<InstructionMode, string> = {
    base: 'Base (all modes)',
    ask: 'Ask',
    autopilot: 'Autopilot',
};

export const MAX_INSTRUCTION_BYTES = 50 * 1024;

interface CustomInstructionsPanelProps {
    instrLoading: boolean;
    instrContents: Record<InstructionMode, string | null>;
    instrDraft: Record<InstructionMode, string>;
    instrSaving: boolean;
    onDraftChange: (mode: InstructionMode, value: string) => void;
    onSave: (mode: InstructionMode) => void;
    onDelete: (mode: InstructionMode) => void;
}

export function CustomInstructionsPanel({
    instrLoading,
    instrContents,
    instrDraft,
    instrSaving,
    onDraftChange,
    onSave,
    onDelete,
}: CustomInstructionsPanelProps) {
    const [instrActiveTab, setInstrActiveTab] = useState<InstructionMode>('base');

    return (
        <div className="flex flex-col gap-3">
            <p className="text-xs text-[#848484]">
                Stored in <code className="font-mono bg-[#f3f3f3] dark:bg-[#333] px-1 rounded">.github/coc/</code> — committed to version control, shared across clones.
            </p>

            {instrLoading ? (
                <div className="text-xs text-[#848484]">Loading...</div>
            ) : (
                <>
                    {/* Tab bar */}
                    <div className="flex gap-0 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        {INSTRUCTION_MODES.map(mode => (
                            <button
                                key={mode}
                                onClick={() => setInstrActiveTab(mode)}
                                className={`relative px-3 py-1.5 text-xs font-medium transition-colors ${
                                    instrActiveTab === mode
                                        ? 'text-[#0078d4] border-b-2 border-[#0078d4] -mb-px'
                                        : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                                }`}
                                data-testid={`instr-tab-${mode}`}
                            >
                                {INSTRUCTION_MODE_LABELS[mode]}
                                {instrContents[mode] !== null && instrContents[mode] !== '' && (
                                    <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[#0078d4] align-middle" />
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Editor area */}
                    {(() => {
                        const mode = instrActiveTab;
                        const draft = instrDraft[mode];
                        const bytes = new TextEncoder().encode(draft).length;
                        const nearLimit = bytes > MAX_INSTRUCTION_BYTES * 0.8;
                        const overLimit = bytes > MAX_INSTRUCTION_BYTES;
                        return (
                            <div className="flex flex-col gap-2">
                                {instrContents[mode] === null && draft === '' && (
                                    <p className="text-xs text-[#848484] italic">
                                        No instructions for this mode. Instructions added here apply to all CoC sessions in this repository.
                                    </p>
                                )}
                                <textarea
                                    className="w-full min-h-[160px] text-xs font-mono p-2 border border-[#e0e0e0] dark:border-[#3c3c3c] rounded bg-[#fafafa] dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] resize-y focus:outline-none focus:border-[#0078d4]"
                                    value={draft}
                                    onChange={e => onDraftChange(mode, e.target.value)}
                                    placeholder={`Add ${mode === 'base' ? 'global' : mode + ' mode'} instructions here…`}
                                    data-testid={`instr-textarea-${mode}`}
                                />
                                {nearLimit && (
                                    <p className={`text-xs ${overLimit ? 'text-red-500' : 'text-amber-500'}`}>
                                        {bytes.toLocaleString()} / {MAX_INSTRUCTION_BYTES.toLocaleString()} bytes
                                        {overLimit ? ' — exceeds limit, content will be truncated' : ''}
                                    </p>
                                )}
                                <div className="flex gap-2 items-center">
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={() => onSave(mode)}
                                        disabled={instrSaving}
                                        data-testid={`instr-save-${mode}`}
                                    >
                                        Save
                                    </Button>
                                    {instrContents[mode] !== null && (
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() => onDelete(mode)}
                                            disabled={instrSaving}
                                            data-testid={`instr-delete-${mode}`}
                                        >
                                            Delete
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })()}
                </>
            )}
        </div>
    );
}
