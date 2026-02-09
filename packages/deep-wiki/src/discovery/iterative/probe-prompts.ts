/**
 * Iterative Discovery — Probe Prompts
 *
 * Prompt templates for per-topic probe sessions.
 * Each probe searches the codebase for evidence of a specific topic.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { TopicSeed } from '../../types';

// ============================================================================
// Topic Probe Prompt
// ============================================================================

/**
 * JSON schema for TopicProbeResult.
 */
const TOPIC_PROBE_RESULT_SCHEMA = `{
  "topic": "string — the topic that was probed",
  "foundModules": [
    {
      "id": "string — suggested module ID (kebab-case)",
      "name": "string — human-readable module name",
      "path": "string — path relative to repo root",
      "purpose": "string — purpose description",
      "keyFiles": ["string — key file paths relative to repo root"],
      "evidence": "string — evidence of why this belongs to the topic",
      "lineRanges": [[number, number]] — optional line ranges for monolithic files
    }
  ],
  "discoveredTopics": [
    {
      "topic": "string — topic name (kebab-case)",
      "description": "string — description",
      "hints": ["string — search hints"],
      "source": "string — where it was discovered (e.g., file path)"
    }
  ],
  "dependencies": ["string — IDs of other topics this topic depends on"],
  "confidence": "number — confidence level (0-1)"
}`;

/**
 * Build the prompt for a per-topic probe session.
 *
 * @param repoPath - Absolute path to the repository
 * @param topic - The topic seed to probe
 * @param focus - Optional subtree to focus on
 * @returns The rendered prompt string
 */
export function buildProbePrompt(
    repoPath: string,
    topic: TopicSeed,
    focus?: string
): string {
    const focusSection = focus
        ? `\n## Focus Area\n\nFocus your analysis on the subtree: ${focus}\nOnly include modules within or directly related to this area.\n`
        : '';

    const hintsList = topic.hints.length > 0
        ? topic.hints.map(h => `- ${h}`).join('\n')
        : `- ${topic.topic}`;

    return `You are investigating the topic "${topic.topic}" in this codebase.
You have access to grep, glob, and view tools to explore the repository at ${repoPath}.

## Topic Description

${topic.description}

## Search Hints

Use these keywords to find related code:
${hintsList}
${focusSection}
## Your Task

1. Use \`grep\` to search for hint keywords across the codebase
2. Use \`view\` to read files that match your searches
3. For large files, sample sections rather than reading the entire file
4. Identify modules/files belonging to this topic
5. Note any ADJACENT topics you discover (related but distinct concerns)
6. Return JSON matching the TopicProbeResult schema

## Exploration Strategy

- Start with broad grep searches using the hints
- Read key files that match (entry points, config files, main implementation files)
- For monolithic files, identify specific line ranges that belong to this topic
- Look for patterns: imports, exports, function names, class names, directory structure
- If you find related but distinct topics, add them to discoveredTopics

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

${TOPIC_PROBE_RESULT_SCHEMA}

## Rules

- Module IDs must be unique lowercase kebab-case identifiers
- All paths must be relative to the repo root (no absolute paths)
- Confidence should reflect how certain you are that you found all relevant code (0.0 = uncertain, 1.0 = very confident)
- discoveredTopics should only include NEW topics not already in the seed list
- dependencies should reference other topic IDs, not module IDs
- For large monolithic files, use lineRanges to specify which sections belong to this topic
- evidence should explain why each module belongs to this topic (file names, function names, patterns found)`;
}
