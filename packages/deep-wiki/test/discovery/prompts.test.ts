/**
 * Prompts Tests
 *
 * Tests for discovery prompt template generation.
 * Verifies template variable substitution and focus area filtering.
 */

import { describe, it, expect } from 'vitest';
import {
    buildDiscoveryPrompt,
    buildStructuralScanPrompt,
    buildFocusedDiscoveryPrompt,
} from '../../src/discovery/prompts';

describe('buildDiscoveryPrompt', () => {
    it('should include the repo path', () => {
        const prompt = buildDiscoveryPrompt('/path/to/repo');
        expect(prompt).toContain('/path/to/repo');
    });

    it('should include exploration instructions', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('glob');
        expect(prompt).toContain('grep');
        expect(prompt).toContain('package.json');
        expect(prompt).toContain('README');
    });

    it('should include the JSON schema', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('"project"');
        expect(prompt).toContain('"modules"');
        expect(prompt).toContain('"categories"');
    });

    it('should include output rules', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('kebab-case');
        expect(prompt).toContain('Complexity');
        expect(prompt).toContain('low');
        expect(prompt).toContain('medium');
        expect(prompt).toContain('high');
    });

    it('should include language-specific heuristics', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('Cargo.toml');
        expect(prompt).toContain('go.mod');
        expect(prompt).toContain('pyproject.toml');
        expect(prompt).toContain('package.json');
    });

    describe('focus area', () => {
        it('should include focus section when focus is provided', () => {
            const prompt = buildDiscoveryPrompt('/repo', 'src/');
            expect(prompt).toContain('Focus your analysis on the subtree: src/');
            expect(prompt).toContain('Only include modules within or directly related to this area');
        });

        it('should NOT include focus section when focus is not provided', () => {
            const prompt = buildDiscoveryPrompt('/repo');
            expect(prompt).not.toContain('Focus your analysis on the subtree');
            expect(prompt).not.toContain('Focus Area');
        });

        it('should include focus section with nested path', () => {
            const prompt = buildDiscoveryPrompt('/repo', 'packages/core/src');
            expect(prompt).toContain('packages/core/src');
        });
    });

    it('should instruct raw JSON output (no markdown)', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('raw JSON only');
    });

    // Feature-focus prompt quality tests
    it('should prioritize documentation reading before file structure scanning', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        const docIndex = prompt.indexOf('Documentation first');
        const fileStructIndex = prompt.indexOf('File structure');
        expect(docIndex).toBeLessThan(fileStructIndex);
    });

    it('should include module naming guidance with good and bad examples', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('Module Naming Guidance');
        expect(prompt).toContain('Good module IDs');
        expect(prompt).toContain('Bad module IDs');
    });

    it('should include anti-pattern examples for path-mirror module IDs', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('src-shortcuts-code-review');
        expect(prompt).toContain('packages-deep-wiki-src-cache');
    });

    it('should include positive examples of feature-focused module IDs', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('inline-code-review');
        expect(prompt).toContain('ai-pipeline-engine');
    });

    it('should instruct not to derive module IDs from file paths', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('Do NOT derive module IDs from file paths');
    });

    it('should instruct to group related files into feature-level modules', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('Group related files into feature-level modules');
    });

    it('should describe modules as features and capabilities in task description', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('feature-oriented module graph');
        expect(prompt).toContain('features, capabilities, and architectural concerns');
    });
});

describe('buildStructuralScanPrompt', () => {
    it('should include the repo path', () => {
        const prompt = buildStructuralScanPrompt('/path/to/repo');
        expect(prompt).toContain('/path/to/repo');
    });

    it('should indicate this is a large repository', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('LARGE repository');
    });

    it('should include the structural scan schema', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('fileCount');
        expect(prompt).toContain('areas');
        expect(prompt).toContain('projectInfo');
    });

    it('should instruct to skip deep directories', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('TOP-LEVEL');
        expect(prompt).toContain('node_modules');
    });

    it('should instruct raw JSON output', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('raw JSON only');
    });

    // Feature-focus prompt quality tests
    it('should prioritize README reading before directory listing', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        const readmeIndex = prompt.indexOf('README.md');
        const globIndex = prompt.indexOf('glob("*")');
        expect(readmeIndex).toBeLessThan(globIndex);
    });

    it('should include area naming guidance for functionality focus', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('Area Naming Guidance');
        expect(prompt).toContain('FUNCTIONALITY');
    });

    it('should instruct area descriptions to explain what the area DOES', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('what the area DOES');
    });

    it('should focus on understanding what each area DOES', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('what each area DOES');
    });
});

describe('buildFocusedDiscoveryPrompt', () => {
    it('should include the repo path', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source code', 'my-project');
        expect(prompt).toContain('/repo');
    });

    it('should include the area path', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'packages/core', 'Core package', 'proj');
        expect(prompt).toContain('packages/core');
    });

    it('should include the area description', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source code directory', 'proj');
        expect(prompt).toContain('Source code directory');
    });

    it('should include the project name', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'my-awesome-project');
        expect(prompt).toContain('my-awesome-project');
    });

    it('should include glob pattern for the area', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'packages/core', 'Core', 'proj');
        expect(prompt).toContain('glob("packages/core/**/*")');
    });

    it('should include module ID prefix convention', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('prefixed with the area name');
    });

    it('should include the JSON schema', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('"project"');
        expect(prompt).toContain('"modules"');
    });

    // Feature-focus prompt quality tests
    it('should include module naming guidance with good and bad examples', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('Module Naming Guidance');
        expect(prompt).toContain('Good');
        expect(prompt).toContain('Bad');
    });

    it('should instruct not to derive module IDs from file paths', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('Do NOT derive module IDs from file paths');
    });

    it('should instruct to group related files into feature-level modules', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('Group related files into feature-level modules');
    });

    it('should focus on features, capabilities, and behavioral patterns', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('features, capabilities, and behavioral patterns');
    });

    it('should instruct to read docs within the area first', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'packages/core', 'Core', 'proj');
        expect(prompt).toContain('Read any README, docs, or config files');
    });
});
