/**
 * Work Item Plan Template
 *
 * Provides a standard markdown template for work item plans.
 * Used when creating work items from chat to ensure a consistent,
 * actionable plan structure.
 *
 * Template sections mirror the structure used in this project's
 * planning workflow (impl skill, session plans, etc.):
 *   - Objective  — the single clear goal
 *   - Background — motivation and context
 *   - Steps      — checkbox-based action items
 *   - Acceptance Criteria — testable completion conditions
 *   - Notes      — constraints, links, or follow-ups
 */

// ============================================================================
// Static template (empty starter)
// ============================================================================

export const WORK_ITEM_PLAN_TEMPLATE = [
    '## Objective',
    '',
    '_State the goal in one or two sentences._',
    '',
    '## Background',
    '',
    '_Context and motivation for this work item._',
    '',
    '## Steps',
    '',
    '- [ ] ',
    '',
    '## Acceptance Criteria',
    '',
    '- [ ] ',
    '',
    '## Notes',
    '',
    '_Additional constraints, links, or follow-ups._',
].join('\n');

// ============================================================================
// Context-aware builder
// ============================================================================

/**
 * Build a plan populated with context from a work item's title and description.
 *
 * @param title       - Work item title (used as the objective).
 * @param description - Optional description / background context.
 * @returns Markdown string suitable for use as an initial work item plan.
 */
export function buildPlanFromContext(title: string, description?: string): string {
    const backgroundSection = description && description.trim()
        ? description.trim()
        : '_Add context and motivation here._';

    return [
        '## Objective',
        '',
        title,
        '',
        '## Background',
        '',
        backgroundSection,
        '',
        '## Steps',
        '',
        '- [ ] ',
        '',
        '## Acceptance Criteria',
        '',
        '- [ ] ',
        '',
        '## Notes',
        '',
        '_Additional constraints, links, or follow-ups._',
    ].join('\n');
}
