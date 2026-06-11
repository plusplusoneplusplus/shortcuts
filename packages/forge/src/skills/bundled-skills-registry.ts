/**
 * Registry of bundled skills that ship with forge.
 */

import type { BundledSkill } from './types';

/**
 * Each skill must have a corresponding directory in resources/bundled-skills/.
 * Version is read from each skill's SKILL.md frontmatter at runtime.
 */
export const BUNDLED_SKILLS_REGISTRY: readonly BundledSkill[] = [
    {
        name: 'pipeline-generator',
        description: 'Generate optimized YAML pipeline or DAG workflow configurations from natural language requirements',
        relativePath: 'pipeline-generator',
    },
    {
        name: 'skill-for-skills',
        description: 'Create and update Agent Skills following the agentskills.io specification',
        relativePath: 'skill-for-skills',
    },
    {
        name: 'go-deep',
        description: 'Advanced research and verification methodologies using multi-phase approaches and parallel sub-agents',
        relativePath: 'go-deep',
    },
    {
        name: 'coc-chat',
        description: 'Access, search, analyze, and submit CoC conversation process records via REST API to a running CoC server',
        relativePath: 'coc-chat',
    },
    {
        name: 'rethink',
        description: 'Review a bug fix proposal and evaluate whether it is the cleanest solution, considering root cause alignment, simplicity, consistency, technical debt, side effects, and idiomatic alternatives',
        relativePath: 'rethink',
    },
    {
        name: 'code-refactoring',
        description: 'Automated code refactoring suggestion that drafts a refactoring plan for critical, high-value technical debt issues',
        relativePath: 'code-refactoring',
    },
    {
        name: 'kb-refresh',
        description: 'Distill recent CoC chat histories into knowledge-base skill improvements, proposing additions, updates, and removals',
        relativePath: 'kb-refresh',
    },
    {
        name: 'update-work-item',
        description: 'Interactively update an existing work item — patch common fields or create a new plan version, then reset status to planning',
        relativePath: 'update-work-item',
    },
    {
        name: 'fresh-written',
        description: 'Rewrite documents, plans, and notes as if authored fresh each iteration — produce only the final intended state, never patch deltas on top of the previous version',
        relativePath: 'fresh-written',
    },
    {
        name: 'terse-replies',
        description: 'Ultra-compressed reply mode that cuts token usage ~50% while keeping full technical accuracy. Triggers on "be brief", "be terse", "less tokens", "/terse", or explicit token-efficiency requests',
        relativePath: 'terse-replies',
    },
    {
        name: 'for-each',
        description: 'Process a list of items by dispatching ONE sub-agent per item, strictly sequentially (await each before the next). Same per-item sub-task and final summary contract as map-reduce — only the dispatch order differs',
        relativePath: 'for-each',
    },
    {
        name: 'map-reduce',
        description: 'Process a list of items by dispatching one sub-agent per item in parallel (up to max_parallel concurrent), then aggregate results into a final summary. Same per-item sub-task and final summary contract as for-each',
        relativePath: 'map-reduce',
    },
    {
        name: 'loop',
        description: 'Schedule recurring follow-up messages into the current conversation. Supports fixed-interval monitoring and one-shot wakeups for dynamic self-pacing',
        relativePath: 'loop',
    },
    {
        name: 'classify-diff',
        description: 'Classify every hunk in a pull request diff by change type (logic, mechanical, test, generated) so reviewers can focus on what matters',
        relativePath: 'classify-diff',
    },
    {
        name: 'grill-me',
        description: 'Interview the user about a plan or design and produce an autonomy-ready spec artifact with decision tags and definition-of-done for Ralph loops. Triggers on "grill me", design stress-tests, or Ralph promotion synthesis.',
        relativePath: 'grill-me',
    },
    {
        name: 'excalidraw-diagram',
        description: 'Generate, read, and iteratively modify Excalidraw diagrams (flowcharts, relationships, mind maps, architecture, DFD, swimlane, class, sequence, ER) with interactive inline previews via excalidraw:// links; ships with templates, schema references, and Python helper scripts',
        relativePath: 'excalidraw-diagram',
    },
    {
        name: 'ultra-ralph',
        description: 'Core instruction sets for Ralph autonomous coding loop phases — grill (clarification), synthesis (goal extraction), execution (iteration), iteration (user prompt), and final-check (read-only validation)',
        relativePath: 'ultra-ralph',
    },
];
