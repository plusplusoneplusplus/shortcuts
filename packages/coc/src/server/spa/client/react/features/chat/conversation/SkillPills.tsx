import React from 'react';
import { cn } from '../../../ui/cn';

export interface SkillPillsProps {
    names: string[];
}

/** Shows the skills a user explicitly selected for a turn as outline pills. */
export function SkillPills({ names }: SkillPillsProps) {
    if (names.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap items-center gap-1.5 mb-2" data-testid="selected-skills-pills">
            <span className="text-[11px] leading-[16px] text-[#6b7280] dark:text-[#9aa0a6]">Skills</span>
            {names.map(name => (
                <span
                    key={name}
                    className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-[2px]',
                        'text-[11px] leading-[16px] whitespace-nowrap',
                        'border border-[#d0d7de] dark:border-[#3c3c3c]',
                        'text-[#57606a] dark:text-[#9aa0a6]',
                    )}
                    data-testid="selected-skill-pill"
                    title={name}
                >
                    {name}
                </span>
            ))}
        </div>
    );
}
