/**
 * Dream system-prompt resolver.
 *
 * The analyzer and critic system prompts live in the bundled `dream` skill
 * (`SKILL.md` with `## Section: analyzer` and `## Section: critic`) rather than
 * as inline TypeScript constants. At runtime the dream step resolves the skill
 * section text server-side and uses it verbatim as the system prompt.
 *
 * The analyzer section carries a single `{{dreamCardCategories}}` placeholder
 * which is filled from `DREAM_CARD_CATEGORIES` so the assembled prompt stays
 * byte-for-byte identical to the former constant.
 */

import * as path from 'path';
import { extractSkillSection, resolveSkillSync } from '@plusplusoneplusplus/forge';
import type { DreamInternalProcessPurpose } from './dream-internal-process';
import { DREAM_CARD_CATEGORIES } from './types';

/** Name of the bundled skill that holds the dream system prompts. */
export const DREAM_SKILL_NAME = 'dream';

/** Placeholder token in the analyzer section, filled from DREAM_CARD_CATEGORIES. */
export const DREAM_CARD_CATEGORIES_PLACEHOLDER = '{{dreamCardCategories}}';

/**
 * Apply runtime placeholder substitution to a raw dream skill section so the
 * result matches the historical constant text exactly.
 */
export function assembleDreamSystemPrompt(sectionText: string): string {
    return sectionText.split(DREAM_CARD_CATEGORIES_PLACEHOLDER).join(DREAM_CARD_CATEGORIES.join(', '));
}

/**
 * Resolve a dream system prompt from raw SKILL.md content.
 *
 * @param content Raw SKILL.md content (frontmatter may or may not be present).
 * @param section Which section to resolve (`analyzer` or `critic`).
 */
export function resolveDreamSystemPromptFromContent(
    content: string,
    section: DreamInternalProcessPurpose,
): string {
    return assembleDreamSystemPrompt(extractSkillSection(content, section));
}

/**
 * Resolve a dream system prompt from the installed skills directory
 * (`<dataDir>/skills/dream/SKILL.md`).
 *
 * There is no inline fallback: if the skill is missing the underlying
 * resolver throws, which surfaces as a natural step error.
 */
export function resolveDreamSystemPrompt(
    section: DreamInternalProcessPurpose,
    options: { dataDir: string },
): string {
    const skillsDir = path.join(options.dataDir, 'skills');
    const content = resolveSkillSync(DREAM_SKILL_NAME, options.dataDir, skillsDir);
    return resolveDreamSystemPromptFromContent(content, section);
}
