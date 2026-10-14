/**
 * Dream skill section resolution and runtime category substitution.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { extractSkillSection, getBundledSkillsPath, SkillSectionNotFoundError } from '@plusplusoneplusplus/forge';
import {
    assembleDreamSystemPrompt,
    DREAM_CARD_CATEGORIES_PLACEHOLDER,
    resolveDreamSystemPromptFromContent,
} from '../../src/server/dreams/dream-prompt-resolver';
import { DREAM_CARD_CATEGORIES } from '../../src/server/dreams/types';

function bundledDreamSkill(): string {
    const skillPath = path.join(getBundledSkillsPath(), 'dream', 'SKILL.md');
    return fs.readFileSync(skillPath, 'utf-8');
}

describe('dream system prompt resolution', () => {
    it('resolves the current bundled analyzer section with category substitution', () => {
        const skill = bundledDreamSkill();
        const analyzer = extractSkillSection(skill, 'analyzer');
        expect(analyzer).toContain(DREAM_CARD_CATEGORIES_PLACEHOLDER);
        const resolved = resolveDreamSystemPromptFromContent(skill, 'analyzer');
        expect(resolved).toBe(analyzer.replaceAll(DREAM_CARD_CATEGORIES_PLACEHOLDER, DREAM_CARD_CATEGORIES.join(', ')));
        expect(resolved).not.toContain(DREAM_CARD_CATEGORIES_PLACEHOLDER);
    });

    it('resolves the current bundled critic section without altering it', () => {
        const skill = bundledDreamSkill();
        const critic = extractSkillSection(skill, 'critic');
        expect(critic.trim()).not.toBe('');
        expect(critic).not.toContain(DREAM_CARD_CATEGORIES_PLACEHOLDER);
        expect(resolveDreamSystemPromptFromContent(skill, 'critic')).toBe(critic);
    });

    it('substitutes every category placeholder while preserving surrounding text', () => {
        const placeholder = DREAM_CARD_CATEGORIES_PLACEHOLDER;
        const categories = DREAM_CARD_CATEGORIES.join(', ');
        expect(assembleDreamSystemPrompt(`before ${placeholder}\nafter ${placeholder}`))
            .toBe(`before ${categories}\nafter ${categories}`);
        expect(assembleDreamSystemPrompt('unchanged')).toBe('unchanged');
        expect(assembleDreamSystemPrompt('')).toBe('');
    });

    it('selects only the requested section with either checkout line ending', () => {
        for (const newline of ['\n', '\r\n']) {
            const skill = ['---', 'name: dream', '---', '## Section: analyzer', 'analyzer payload',
                '## Section: critic', 'critic payload'].join(newline);
            expect(resolveDreamSystemPromptFromContent(skill, 'analyzer')).toBe('analyzer payload');
            expect(resolveDreamSystemPromptFromContent(skill, 'critic')).toBe('critic payload');
        }
    });

    it('surfaces a missing section rather than falling back to another prompt', () => {
        expect(() => resolveDreamSystemPromptFromContent('## Section: critic\ncritic payload', 'analyzer'))
            .toThrow(SkillSectionNotFoundError);
    });
});
