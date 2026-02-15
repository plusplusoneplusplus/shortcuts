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
  "foundComponents": [
    {
      "id": "string — suggested component ID (kebab-case) describing the FEATURE, not the file path",
      "name": "string — human-readable name describing what this component DOES",
      "path": "string — path relative to repo root",
      "purpose": "string — what this component does for users or the system",
      "keyFiles": ["string — key file paths relative to repo root"],
      "evidence": "string — behavioral evidence: what functions/APIs/data flows prove this belongs to the topic",
      "lineRanges": [[number, number]] — optional line ranges for monolithic files
    }
  ],
  "discoveredTopics": [
    {
      "topic": "string — topic name (kebab-case) describing the FEATURE concern",
      "description": "string — what this feature/concern does",
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
        ? `\n## Focus Area\n\nFocus your analysis on the subtree: ${focus}\nOnly include components within or directly related to this area.\n`
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
4. Identify feature-level components belonging to this topic (group related files together)
5. Note any ADJACENT topics you discover (related but distinct concerns)
6. Return JSON matching the TopicProbeResult schema

## Exploration Strategy

- Start with broad grep searches using the hints
- Read key files that match (entry points, config files, main implementation files)
- Focus on BEHAVIORAL evidence: what functions are called, what APIs are exposed, what data flows through the code
- For monolithic files, identify specific line ranges that belong to this topic
- Look for patterns: imports, exports, function names, class names, API surfaces, event handlers
- If you find related but distinct topics, add them to discoveredTopics

## Component Naming Guidance

Component IDs should describe WHAT the code does, not echo file/directory names.

**Good**: "session-pool-manager", "yaml-pipeline-executor", "comment-anchoring"
**Bad**: "src-ai-service", "pipeline-core-index", "comment-anchor" (just the file name)

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

${TOPIC_PROBE_RESULT_SCHEMA}

## Rules

- Component IDs must be unique lowercase kebab-case identifiers describing the FEATURE
- Do NOT derive component IDs from file paths — describe what the component DOES
- All paths must be relative to the repo root (no absolute paths)
- Confidence should reflect how certain you are that you found all relevant code (0.0 = uncertain, 1.0 = very confident)
- discoveredTopics should only include NEW topics not already in the seed list
- dependencies should reference other topic IDs, not component IDs
- For large monolithic files, use lineRanges to specify which sections belong to this topic
- evidence should cite behavioral proof: function calls, API surfaces, data flows — not just "found in file X"`;
}
