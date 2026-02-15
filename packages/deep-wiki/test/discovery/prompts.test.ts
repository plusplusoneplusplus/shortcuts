/**
 * Prompts Tests
 *
 * Tests for discovery prompt template generation.
 * Verifies template variable substitution and focus domain filtering.
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
        expect(prompt).toContain('"components"');
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

    describe('focus domain', () => {
        it('should include focus section when focus is provided', () => {
            const prompt = buildDiscoveryPrompt('/repo', 'src/');
            expect(prompt).toContain('Focus your analysis on the subtree: src/');
            expect(prompt).toContain('Only include components within or directly related to this area');
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

    it('should include component naming guidance with good and bad examples', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('Component Naming Guidance');
        expect(prompt).toContain('Good component IDs');
        expect(prompt).toContain('Bad component IDs');
    });

    it('should include anti-pattern examples for path-mirror component IDs', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('src-shortcuts-code-review');
        expect(prompt).toContain('packages-deep-wiki-src-cache');
    });

    it('should include positive examples of feature-focused component IDs', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('inline-code-review');
        expect(prompt).toContain('ai-pipeline-engine');
    });

    it('should instruct not to derive component IDs from file paths', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('Do NOT derive component IDs from file paths');
    });

    it('should instruct to group related files into feature-level components', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('Group related files into feature-level components');
    });

    it('should describe components as features and capabilities in task description', () => {
        const prompt = buildDiscoveryPrompt('/repo');
        expect(prompt).toContain('feature-oriented component graph');
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
        expect(prompt).toContain('domains');
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

    it('should include domain naming guidance for functionality focus', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('Domain Naming Guidance');
        expect(prompt).toContain('FUNCTIONALITY');
    });

    it('should instruct domain descriptions to explain what the domain DOES', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('what the domain DOES');
    });

    it('should focus on understanding what each domain DOES', () => {
        const prompt = buildStructuralScanPrompt('/repo');
        expect(prompt).toContain('what each domain DOES');
    });
});

describe('buildFocusedDiscoveryPrompt', () => {
    it('should include the repo path', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source code', 'my-project');
        expect(prompt).toContain('/repo');
    });

    it('should include the domain path', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'packages/core', 'Core package', 'proj');
        expect(prompt).toContain('packages/core');
    });

    it('should include the domain description', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source code directory', 'proj');
        expect(prompt).toContain('Source code directory');
    });

    it('should include the project name', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'my-awesome-project');
        expect(prompt).toContain('my-awesome-project');
    });

    it('should include glob pattern for the domain', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'packages/core', 'Core', 'proj');
        expect(prompt).toContain('glob("packages/core/**/*")');
    });

    it('should include component ID prefix convention', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('prefixed with the domain name');
    });

    it('should include the JSON schema', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('"project"');
        expect(prompt).toContain('"components"');
    });

    // Feature-focus prompt quality tests
    it('should include component naming guidance with good and bad examples', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('Component Naming Guidance');
        expect(prompt).toContain('Good');
        expect(prompt).toContain('Bad');
    });

    it('should instruct not to derive component IDs from file paths', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('Do NOT derive component IDs from file paths');
    });

    it('should instruct to group related files into feature-level components', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('Group related files into feature-level components');
    });

    it('should focus on features, capabilities, and behavioral patterns', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'src/', 'Source', 'proj');
        expect(prompt).toContain('features, capabilities, and behavioral patterns');
    });

    it('should instruct to read docs within the domain first', () => {
        const prompt = buildFocusedDiscoveryPrompt('/repo', 'packages/core', 'Core', 'proj');
        expect(prompt).toContain('Read any README, docs, or config files');
    });
});
