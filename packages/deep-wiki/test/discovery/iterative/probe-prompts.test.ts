/**
 * Probe Prompts Tests
 *
 * Tests for probe prompt template generation.
 * Verifies topic information, hints, and focus domain filtering.
 */

import { describe, it, expect } from 'vitest';
import { buildProbePrompt } from '../../../src/discovery/iterative/probe-prompts';
import type { TopicSeed } from '../../../src/types';

describe('buildProbePrompt', () => {
    const topic: TopicSeed = {
        topic: 'authentication',
        description: 'User authentication and authorization logic',
        hints: ['auth', 'login', 'password', 'token'],
    };

    it('should include the repo path', () => {
        const prompt = buildProbePrompt('/path/to/repo', topic);
        expect(prompt).toContain('/path/to/repo');
    });

    it('should include the topic name', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('authentication');
    });

    it('should include the topic description', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('User authentication and authorization logic');
    });

    it('should include search hints', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('auth');
        expect(prompt).toContain('login');
        expect(prompt).toContain('password');
        expect(prompt).toContain('token');
    });

    it('should include the JSON schema', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('"topic"');
        expect(prompt).toContain('"foundModules"');
        expect(prompt).toContain('"discoveredTopics"');
        expect(prompt).toContain('"confidence"');
    });

    it('should include exploration instructions', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('grep');
        expect(prompt).toContain('view');
        expect(prompt).toContain('glob');
    });

    it('should handle topic with no hints', () => {
        const topicNoHints: TopicSeed = {
            topic: 'api-gateway',
            description: 'API gateway implementation',
            hints: [],
        };
        const prompt = buildProbePrompt('/repo', topicNoHints);
        expect(prompt).toContain('api-gateway');
    });

    describe('focus domain', () => {
        it('should include focus section when focus is provided', () => {
            const prompt = buildProbePrompt('/repo', topic, 'src/');
            expect(prompt).toContain('Focus your analysis on the subtree: src/');
            expect(prompt).toContain('Focus Area');
        });

        it('should NOT include focus section when focus is not provided', () => {
            const prompt = buildProbePrompt('/repo', topic);
            expect(prompt).not.toContain('Focus your analysis on the subtree');
            expect(prompt).not.toContain('Focus Area');
        });
    });

    it('should handle special characters in topic names', () => {
        const specialTopic: TopicSeed = {
            topic: 'api-gateway-v2',
            description: 'API gateway v2 with special chars: <>&"',
            hints: ['api', 'gateway'],
        };
        const prompt = buildProbePrompt('/repo', specialTopic);
        expect(prompt).toContain('api-gateway-v2');
        // Should not break JSON schema
        expect(prompt).toContain('"topic"');
    });

    it('should instruct raw JSON output (no markdown)', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('raw JSON only');
        expect(prompt).toContain('Do NOT wrap it in markdown code blocks');
    });

    // Feature-focus prompt quality tests
    it('should include module naming guidance with good and bad examples', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('Module Naming Guidance');
        expect(prompt).toContain('Good');
        expect(prompt).toContain('Bad');
    });

    it('should instruct not to derive module IDs from file paths', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('Do NOT derive module IDs from file paths');
    });

    it('should emphasize behavioral evidence in exploration strategy', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('BEHAVIORAL evidence');
        expect(prompt).toContain('API surfaces');
        expect(prompt).toContain('data flows');
    });

    it('should instruct to identify feature-level modules', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('feature-level modules');
    });

    it('should require behavioral proof in evidence field', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('behavioral proof');
    });

    it('should include feature-focused schema descriptions for module fields', () => {
        const prompt = buildProbePrompt('/repo', topic);
        expect(prompt).toContain('describing the FEATURE');
        expect(prompt).toContain('what this module DOES');
    });
});
