import type { SkillInfo } from '@plusplusoneplusplus/coc-client';

export interface SkillFileEntry {
    name: string;
    relativePath: string;
    kind: 'reference' | 'script';
}

export function getSkillFileEntries(skill: Pick<SkillInfo, 'references' | 'scripts'>): SkillFileEntry[] {
    return [
        ...(skill.references ?? []).map(name => ({
            name,
            relativePath: `references/${name}`,
            kind: 'reference' as const,
        })),
        ...(skill.scripts ?? []).map(name => ({
            name,
            relativePath: `scripts/${name}`,
            kind: 'script' as const,
        })),
    ];
}

export function SkillVersionBadge({
    version,
    className,
    testId,
}: {
    version?: string;
    className?: string;
    testId?: string;
}) {
    if (!version) {return null;}
    return (
        <span
            className={className ?? 'text-[10px] bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#1a73e8] dark:text-[#8ab4f8] px-1.5 py-0.5 rounded'}
            data-testid={testId}
        >
            v{version}
        </span>
    );
}
