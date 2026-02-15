/**
 * Iterative Discovery — Merge Prompts
 *
 * Prompt templates for the merge + gap analysis session.
 * Merges probe results, identifies gaps, and determines convergence.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ComponentGraph } from '../../types';
import type { ThemeProbeResult } from './types';
import { COMPONENT_GRAPH_SCHEMA } from '../../schemas';

// ============================================================================
// Merge Prompt
// ============================================================================

/**
 * JSON schema for MergeResult.
 */
const MERGE_RESULT_SCHEMA = `{
  "graph": ${COMPONENT_GRAPH_SCHEMA.replace(/\n/g, '\n  ')},
  "newThemes": [
    {
      "theme": "string — theme name (kebab-case)",
      "description": "string — description",
      "hints": ["string — search hints"]
    }
  ],
  "converged": "boolean — whether convergence was reached",
  "coverage": "number — coverage estimate (0-1)",
  "reason": "string — reason for convergence or why not converged"
}`;

/**
 * Build the merge + gap analysis prompt.
 *
 * @param repoPath - Absolute path to the repository
 * @param probeResults - All probe results from the current round
 * @param existingGraph - Existing partial graph (if any, from prior rounds)
 * @returns The rendered prompt string
 */
export function buildMergePrompt(
    repoPath: string,
    probeResults: ThemeProbeResult[],
    existingGraph: ComponentGraph | null
): string {
    const probeResultsJson = JSON.stringify(probeResults, null, 2);
    const existingGraphJson = existingGraph ? JSON.stringify(existingGraph, null, 2) : null;

    const existingGraphSection = existingGraph
        ? `\n## Existing Graph (from prior rounds)\n\n${existingGraphJson}\n\nMerge new findings into this existing graph.`
        : '\n## First Round\n\nThis is the first round. Build the initial graph from the probe results.';

    return `You are merging theme probe results and analyzing coverage gaps in the codebase at ${repoPath}.
You have access to grep, glob, and view tools to explore the repository.

## Probe Results (Current Round)

${probeResultsJson}
${existingGraphSection}
## Your Task

1. **Merge all probe results** into a coherent ComponentGraph:
   - Combine components found across different probes
   - Resolve overlapping component claims (same files claimed by multiple themes)
   - Deduplicate components with the same ID or path
   - Merge dependencies and dependents
   - Ensure component IDs are unique and normalized

2. **Identify coverage gaps**:
   - Use glob("**/*") to see all directories/files
   - Identify directories/files that NO probe touched
   - Estimate what percentage of the codebase is covered (coverage: 0-1)

3. **Collect discovered themes**:
   - Gather all discoveredThemes from all probes
   - Deduplicate themes (same theme from multiple sources)
   - Filter out themes that are too vague or already covered

4. **Determine convergence**:
   - converged=true if: coverage >= 0.8 AND no new themes discovered
   - converged=true if: all major domains have been probed and no gaps remain
   - converged=false if: significant gaps exist or new themes were discovered

## Output Format

Return a **single JSON object** matching this schema exactly. Do NOT wrap it in markdown code blocks. Return raw JSON only.

${MERGE_RESULT_SCHEMA}

## Rules

- Component IDs must be unique lowercase kebab-case identifiers
- All paths must be relative to the repo root
- When resolving overlaps, prefer the probe with higher confidence
- coverage should be a realistic estimate (0.0 = nothing covered, 1.0 = fully covered)
- newThemes should only include themes worth probing in the next round
- reason should explain why convergence was reached or not (e.g., "coverage 0.85, no new themes" or "coverage 0.6, 3 new themes discovered")
- If this is the first round, build a complete graph structure even if coverage is low`;
}
