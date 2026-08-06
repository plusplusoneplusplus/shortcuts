/**
 * SkillBrowserDialog — small centered modal for picking exactly one skill.
 *
 * Wraps `SkillPickerPanel` (the same searchable, repo/global grouped list used
 * by the EnqueueDialog picker) for surfaces that need a single-select-then-close
 * flow instead of multi-select chips — e.g. the Git tab's commit context menu,
 * where a long skill list does not fit in a hover submenu.
 */

import { useCallback } from 'react';
import { Dialog } from '../ui/Dialog';
import { SkillPickerPanel, type SkillOption } from './SkillPicker';

export interface SkillBrowserDialogProps {
    open: boolean;
    skills: SkillOption[];
    onSelect: (name: string) => void;
    onClose: () => void;
    title?: string;
}

export function SkillBrowserDialog({ open, skills, onSelect, onClose, title = 'Run a skill' }: SkillBrowserDialogProps) {
    const handleSelect = useCallback((name: string) => {
        onSelect(name);
        onClose();
    }, [onSelect, onClose]);

    if (!open) return null;

    return (
        <Dialog open={open} onClose={onClose} title={title} className="max-w-[420px]" id="skill-browser-dialog">
            <div
                className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-md overflow-hidden"
                data-testid="skill-browser-dialog"
            >
                <SkillPickerPanel
                    skills={skills}
                    selectedSkills={[]}
                    onSelect={handleSelect}
                    onDismiss={onClose}
                    listHeightClass="max-h-[50vh]"
                />
            </div>
        </Dialog>
    );
}
