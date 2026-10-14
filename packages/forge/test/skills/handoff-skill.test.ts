/**
 * Tests for the `handoff` bundled skill file presence and content.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { BUNDLED_SKILLS_REGISTRY } from '../../src/skills/bundled-skills-registry';

const SKILL_FILE = path.resolve(__dirname, '../../resources/bundled-skills/handoff/SKILL.md');

function readMetadata() {
    const content = fs.readFileSync(SKILL_FILE, 'utf8');
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(frontmatter).toBeTruthy();
    return yaml.parse(frontmatter![1]);
}

describe('handoff bundled skill', () => {
    it('is registered in BUNDLED_SKILLS_REGISTRY', () => {
        const entry = BUNDLED_SKILLS_REGISTRY.find(s => s.name === 'handoff');
        expect(entry).toBeDefined();
        expect(entry?.relativePath).toBe('handoff');
    });

    it('has YAML frontmatter with name, description and a parsable version', () => {
        const metadata = readMetadata();
        expect(metadata.name).toBe('handoff');
        expect(metadata.description).toEqual(expect.any(String));
        expect(metadata.description.trim()).not.toBe('');
        expect(metadata.metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('keeps the upstream invocation flags', () => {
        const metadata = readMetadata();
        expect(metadata['argument-hint']).toEqual(expect.any(String));
        expect(metadata['argument-hint'].trim()).not.toBe('');
        expect(metadata['disable-model-invocation']).toBe(true);
    });

    it('credits the upstream source', () => {
        expect(readMetadata().metadata).toMatchObject({
            author: 'Matt Pocock',
            source: 'https://github.com/mattpocock/skills/blob/main/skills/productivity/handoff/SKILL.md',
        });
    });
});
