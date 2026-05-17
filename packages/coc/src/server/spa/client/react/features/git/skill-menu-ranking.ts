/**
 * Skill Menu Ranking — orders skills by commit-scoped recency for the
 * Git tab "Use Skill" context menu.
 *
 * Pure function with no React or DOM dependencies so it's easy to unit-test.
 */

/** Maximum number of skills shown as direct children of "Use Skill". */
export const MRU_SKILL_LIMIT = 5;

export interface RankedSkill {
    name: string;
}

/**
 * Rank skills by commit-scoped recency.
 *
 * - Skills with a timestamp in `usageMap` sort newest-first (descending ISO string).
 * - Skills without a timestamp sort alphabetically by lowercased name.
 * - Timestamped skills always precede untimestamped ones.
 */
export function rankSkillsByRecency(
    skills: readonly RankedSkill[],
    usageMap: Record<string, string>,
): RankedSkill[] {
    const used: RankedSkill[] = [];
    const unused: RankedSkill[] = [];

    for (const skill of skills) {
        if (usageMap[skill.name]) {
            used.push(skill);
        } else {
            unused.push(skill);
        }
    }

    used.sort((a, b) => usageMap[b.name].localeCompare(usageMap[a.name]));
    unused.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    return [...used, ...unused];
}
