import React, { useState } from 'react';
import { cn } from '../../../ui/cn';
import { CopyButton } from '../../dev-tools/CopyButton';

export interface InjectedBlockChipsProps {
    /** Verbatim `<coc-chat-mode>` block, if the turn carried one. */
    chatMode?: string;
    /** Verbatim `<chat-style>` block, if the turn carried one. */
    chatStyle?: string;
    /** Verbatim `<selected_skills>` block, if the turn carried one. */
    selectedSkills?: string;
    /** Skill names parsed out of `selectedSkills`; drives one chip each. */
    skillNames?: string[];
}

/** Skills shown before the `+N` chip takes over. */
const SKILL_CHIP_LIMIT = 4;

type ChipKind = 'mode' | 'style' | 'skill';

interface Chip {
    /** Stable identity for the open/closed panel state. */
    id: string;
    kind: ChipKind;
    label: string;
    /** The exact injected text this chip reveals. */
    block: string;
}

/**
 * Names the mode a directive put the turn in. The directive body is built by
 * `buildChatModeDirective`, so read-only and the autopilot transition note are
 * located by their own markers rather than by string equality; anything else
 * (including older or hand-written blocks) falls back to a plain label.
 */
function chatModeLabel(block: string): string {
    if (block.includes('<coc-read-only-mode>')) {
        return 'Ask';
    }
    if (block.includes('switched to autopilot mode')) {
        return 'Autopilot';
    }
    const named = /Current mode:[ \t]*([A-Za-z][\w-]*)/.exec(block);
    if (named) {
        return named[1].charAt(0).toUpperCase() + named[1].slice(1);
    }
    return 'Chat mode';
}

/** Reads the style name off the `Selected style: <label>.` line. */
function chatStyleLabel(block: string): string {
    const match = /^Selected style:[ \t]*(.+?)\.?[ \t]*$/m.exec(block);
    return match ? match[1] : 'Chat style';
}

/** Accent per chip kind, so the three block types read apart at a glance. */
const CHIP_KIND_CLASSES: Record<ChipKind, string> = {
    mode: cn(
        'border-[#b7e1cd] bg-[#e6f4ea] text-[#15703a]',
        'dark:border-[#2a5a3a] dark:bg-[#1a3a2a] dark:text-[#4ade80]',
    ),
    style: cn(
        'border-[#ffe082] bg-[#fff8e1] text-[#8a6d00]',
        'dark:border-[#5a4a2a] dark:bg-[#3a2f1a] dark:text-[#fbbf24]',
    ),
    skill: cn(
        'border-[#b3d7ff] bg-[#dceeff] text-[#005a9e]',
        'dark:border-[#2a4a66] dark:bg-[#0d2a42] dark:text-[#7bbef3]',
    ),
};

function buildChips({ chatMode, chatStyle, selectedSkills, skillNames }: InjectedBlockChipsProps): Chip[] {
    const chips: Chip[] = [];
    if (chatMode) {
        chips.push({ id: 'chat-mode', kind: 'mode', label: chatModeLabel(chatMode), block: chatMode });
    }
    if (chatStyle) {
        chips.push({ id: 'chat-style', kind: 'style', label: chatStyleLabel(chatStyle), block: chatStyle });
    }
    if (selectedSkills) {
        const names = skillNames ?? [];
        if (names.length === 0) {
            // The block is present but its sentence did not parse — still offer
            // the raw text under a generic chip rather than hiding it.
            chips.push({ id: 'selected-skills', kind: 'skill', label: 'Selected skills', block: selectedSkills });
        }
        for (const name of names) {
            chips.push({ id: `skill:${name}`, kind: 'skill', label: name, block: selectedSkills });
        }
    }
    return chips;
}

/**
 * Renders the server-injected prefix blocks of a user turn as one chip row.
 * Clicking a chip opens the verbatim block below the row; only one is open at
 * a time, and clicking the open chip closes it.
 */
export function InjectedBlockChips(props: InjectedBlockChipsProps) {
    const [openId, setOpenId] = useState<string | undefined>(undefined);
    const [showAllSkills, setShowAllSkills] = useState(false);

    const chips = buildChips(props);
    if (chips.length === 0) {
        return null;
    }

    const skillChips = chips.filter(chip => chip.kind === 'skill');
    const overflowCount = showAllSkills ? 0 : Math.max(0, skillChips.length - SKILL_CHIP_LIMIT);
    const hidden = overflowCount > 0 ? new Set(skillChips.slice(SKILL_CHIP_LIMIT).map(chip => chip.id)) : undefined;
    const visible = hidden ? chips.filter(chip => !hidden.has(chip.id)) : chips;
    const open = chips.find(chip => chip.id === openId);

    return (
        <div className="mt-1.5" data-testid="injected-block-chips">
            <div className="flex flex-wrap items-center gap-1.5">
                {visible.map(chip => (
                    <button
                        key={chip.id}
                        type="button"
                        className={cn(
                            'inline-flex items-center rounded-full border px-2 py-[2px] cursor-pointer',
                            'text-[11px] leading-[16px] whitespace-nowrap transition-colors',
                            CHIP_KIND_CLASSES[chip.kind],
                            chip.id === openId && 'ring-1 ring-current',
                        )}
                        data-testid="injected-block-chip"
                        data-chip-kind={chip.kind}
                        data-chip-id={chip.id}
                        title={chip.label}
                        aria-expanded={chip.id === openId}
                        onClick={() => setOpenId(current => (current === chip.id ? undefined : chip.id))}
                    >
                        {chip.label}
                    </button>
                ))}
                {overflowCount > 0 && (
                    <button
                        type="button"
                        className={cn(
                            'inline-flex items-center rounded-full border px-2 py-[2px] cursor-pointer',
                            'text-[11px] leading-[16px] whitespace-nowrap',
                            'border-[#d0d7de] text-[#57606a] dark:border-[#3c3c3c] dark:text-[#9aa0a6]',
                        )}
                        data-testid="injected-block-chips-more"
                        onClick={() => setShowAllSkills(true)}
                    >
                        {`+${overflowCount}`}
                    </button>
                )}
            </div>
            {open && (
                <div className="mt-1.5 flex items-start gap-1.5" data-testid="injected-block-panel">
                    <pre
                        className={cn(
                            'flex-1 min-w-0 overflow-auto max-h-[16rem]',
                            'text-[11px] leading-[1.5] font-mono whitespace-pre-wrap break-all',
                            'text-[#6b7280] dark:text-[#9aa0a6]',
                        )}
                        data-testid="injected-block-body"
                    >
                        {open.block}
                    </pre>
                    <CopyButton text={open.block} label="Copy injected block" testId="injected-block-copy" />
                </div>
            )}
        </div>
    );
}
