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
});
