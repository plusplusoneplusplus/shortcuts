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

        it('should include max themes in prompt', () => {
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
            expect(prompt).toContain('themes');
            expect(prompt).toContain('theme');
            expect(prompt).toContain('description');
            expect(prompt).toContain('hints');
        });

        it('should include kebab-case requirement for theme IDs', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('kebab-case');
        });

        it('should include max themes limit in rules', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 30);
            expect(prompt).toContain('up to 30');
        });

        // Feature-focus prompt quality tests
        it('should prioritize documentation reading before directory scanning', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            const docIndex = prompt.indexOf('Documentation first');
            const dirIndex = prompt.indexOf('Directory structure');
            expect(docIndex).toBeLessThan(dirIndex);
        });

        it('should include anti-pattern guidance against file-name-derived themes', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('Anti-Patterns');
            expect(prompt).toContain('Do NOT name themes after individual files');
            expect(prompt).toContain('Do NOT name themes after directory paths');
        });

        it('should include good vs bad naming examples', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('Good theme names');
            expect(prompt).toContain('Bad theme names');
            // Good examples
            expect(prompt).toContain('inline-code-review');
            expect(prompt).toContain('ai-powered-analysis');
            // Bad examples
            expect(prompt).toContain('extension-entry-point');
            expect(prompt).toContain('types-and-interfaces');
        });

        it('should emphasize feature-level focus in task description', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('feature-level themes');
            expect(prompt).toContain('user-facing capability');
        });

        it('should instruct against generic code artifact themes', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('Do NOT create themes for generic code artifacts');
        });

        it('should include feature-focused schema description for theme field', () => {
            const prompt = buildSeedsPrompt('/path/to/repo', 50);
            expect(prompt).toContain('describing the FEATURE');
        });
    });
});
