/**
 * Byte-identical parity tests for the dream system prompts.
 *
 * The analyzer and critic system prompts were migrated out of inline TypeScript
 * constants into the bundled `dream` skill. These tests assert the resolver
 * reproduces the exact former constant text (captured in the fixture, including
 * the resolved `DREAM_CARD_CATEGORIES` list) so the model still receives a
 * byte-for-byte identical system prompt.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { getBundledSkillsPath } from '@plusplusoneplusplus/forge';
import {
    DREAM_CARD_CATEGORIES_PLACEHOLDER,
    resolveDreamSystemPromptFromContent,
} from '../../src/server/dreams/dream-prompt-resolver';
import { DREAM_CARD_CATEGORIES } from '../../src/server/dreams/types';

const fixture = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'dream-system-prompts.fixture.json'), 'utf-8'),
) as { analyzer: string; critic: string };

function bundledDreamSkill(): string {
    const skillPath = path.join(getBundledSkillsPath(), 'dream', 'SKILL.md');
    return fs.readFileSync(skillPath, 'utf-8');
}

describe('dream system prompt parity', () => {
    it('resolves the analyzer section byte-for-byte to the former constant', () => {
        const resolved = resolveDreamSystemPromptFromContent(bundledDreamSkill(), 'analyzer');
        expect(resolved).toBe(fixture.analyzer);
    });

    it('resolves the critic section byte-for-byte to the former constant', () => {
        const resolved = resolveDreamSystemPromptFromContent(bundledDreamSkill(), 'critic');
        expect(resolved).toBe(fixture.critic);
    });

    it('fills the category placeholder from DREAM_CARD_CATEGORIES', () => {
        const skill = bundledDreamSkill();
        // The static skill keeps a placeholder; the resolved prompt has the list.
        expect(skill).toContain(DREAM_CARD_CATEGORIES_PLACEHOLDER);
        const resolved = resolveDreamSystemPromptFromContent(skill, 'analyzer');
        expect(resolved).not.toContain(DREAM_CARD_CATEGORIES_PLACEHOLDER);
        expect(resolved).toContain(`Use exactly these categories: ${DREAM_CARD_CATEGORIES.join(', ')}.`);
    });
});
