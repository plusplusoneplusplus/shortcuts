/**
 * Seeds Prompts Tests
 *
 * Tests for the seeds prompt template generation.
 */

import { describe, it, expect } from 'vitest';
import { buildSeedsPrompt } from '../../src/seeds/prompts';

describe('Seeds Prompts', () => {
    describe('buildSeedsPrompt', () => {
        it('should include repository path in prompt', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('/path/to/repo');
        });

        it('should include max topics in prompt', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('up to 50');
        });

        it('should include instructions to scan README and manifests', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('README.md');
            expect(prompt).toContain('package.json');
            expect(prompt).toContain('Cargo.toml');
            expect(prompt).toContain('go.mod');
        });

        it('should include instructions to examine directory structure', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('glob');
            expect(prompt).toContain('directory');
        });

        it('should mention expected JSON format', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('JSON');
            expect(prompt).toContain('topics');
            expect(prompt).toContain('topic');
            expect(prompt).toContain('description');
            expect(prompt).toContain('hints');
        });

        it('should include kebab-case requirement for topic IDs', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('kebab-case');
        });

        it('should include max topics limit in rules', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 30);
            expect(prompt).toContain('up to 30');
        });
    });
});
