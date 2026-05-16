/**
 * Mock data for AI-related PR review features.
 *
 * The AI summary, lens grid, grouped threads, conversation timeline,
 * commit intent, checks/CI, merge readiness, file annotations, and
 * AI assistant chat are all driven by the deterministic fixtures
 * declared here. Once a real AI backend is available, these can be
 * swapped out for live data without changing the surrounding
 * presentational components.
 */

import type { PullRequest } from './pr-utils';

export type FindingTag = 'good' | 'risk' | 'note' | 'ai';
export type CommitIntent = 'feat' | 'fix' | 'docs' | 'test' | 'refactor' | 'chore';
export type RiskLevel = 'Low' | 'Medium' | 'High';
export type CheckStatus = 'ok' | 'warn' | 'fail';
export type MergeReadinessTag = 'good' | 'risk' | 'note';
export type AiTimelineKind = 'ai' | 'reviewer' | 'author';

export interface AiMetric {
    key: string;
    value: string;
}

export interface AiFinding {
    tag: FindingTag;
    label: string;
    body: string;
}

export interface AiSummary {
    risk: RiskLevel;
    confidence: number;
    summary: string;
    metrics: AiMetric[];
    findings: AiFinding[];
    blockingThreadCount: number;
    unresolvedCount: number;
}

export interface PersonaLens {
    persona: 'Reviewer' | 'Author' | 'Tech lead';
    body: string;
}

export interface AiTimelineEvent {
    initials: string;
    kind: AiTimelineKind;
    title: string;
    detail: string;
}

export interface AiThreadGroup {
    id: string;
    title: string;
    count: number;
    severity: 'blocking' | 'non-blocking' | 'noise';
    body: string;
}

export interface AiCommitRow {
    id: string;
    title: string;
    intent: CommitIntent;
    note: string;
    hash: string;
}

export interface AiCheckRow {
    id: string;
    name: string;
    status: CheckStatus;
    duration: string;
    interpretation: string;
}

export interface MergeReadinessItem {
    tag: MergeReadinessTag;
    label: string;
    body: string;
}

export interface AiFileAnnotation {
    title: string;
    body: string;
    actions: string[];
}

export interface AiFileEntry {
    path: string;
    additions: number;
    deletions: number;
    focus?: 'AI focus file' | 'Coverage gap' | 'Generated';
    diff?: AiDiffLine[];
    annotation?: AiFileAnnotation;
}

export type AiDiffLineKind = 'add' | 'del' | 'ctx';
export interface AiDiffLine {
    line: number;
    kind: AiDiffLineKind;
    text: string;
}

export interface AiBranchSnapshot {
    sourceBranch: string;
    targetBranch: string;
    additions: number;
    deletions: number;
    commitCount: number;
    fileCount: number;
}

export interface AiChatMessage {
    id: string;
    role: 'ai' | 'user';
    body: string;
    sources?: string[];
}

export interface AiSuggestedPrompt {
    id: string;
    label: string;
    answer: string;
    sources?: string[];
}

const INTENT_TAG_CLASS: Record<CommitIntent, string> = {
    feat: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    fix: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
    docs: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    test: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    refactor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
    chore: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

export function commitIntentClass(intent: CommitIntent): string {
    return INTENT_TAG_CLASS[intent];
}

const FINDING_TAG_CLASS: Record<FindingTag, string> = {
    good: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    risk: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
    note: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    ai: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
};

export function findingTagClass(tag: FindingTag): string {
    return FINDING_TAG_CLASS[tag];
}

export function checkStatusClass(status: CheckStatus): string {
    switch (status) {
        case 'ok':   return 'text-green-700 dark:text-green-300';
        case 'warn': return 'text-yellow-700 dark:text-yellow-300';
        case 'fail': return 'text-red-700 dark:text-red-400';
    }
}

export function riskPillClass(risk: RiskLevel): string {
    switch (risk) {
        case 'Low':    return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200';
        case 'Medium': return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-200';
        case 'High':   return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200';
    }
}

/**
 * Hash a string into a small unsigned integer. Used to make per-PR mock
 * data deterministic without seeding the global RNG.
 */
function hashString(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function pickFromList<T>(list: T[], seed: number, salt = 0): T {
    return list[(seed + salt) % list.length];
}

const RISK_BY_KEYWORD: Array<{ test: RegExp; risk: RiskLevel }> = [
    { test: /(refactor|migrate|breaking|rewrite|scheduler)/i, risk: 'High' },
    { test: /(stream|queue|cache|persistence|worker|backpressure)/i, risk: 'Medium' },
    { test: /(docs?|comment|typo|readme|fixture|test)/i, risk: 'Low' },
];

function inferRisk(pr: PullRequest, seed: number): RiskLevel {
    const haystack = `${pr.title} ${pr.description ?? ''}`;
    for (const entry of RISK_BY_KEYWORD) {
        if (entry.test.test(haystack)) return entry.risk;
    }
    const ladder: RiskLevel[] = ['Low', 'Medium', 'High'];
    return ladder[seed % ladder.length];
}

const REVIEW_TIMES = ['6 min', '9 min', '14 min', '22 min', '32 min'];
const IMPACT_LABELS = ['Ingest', 'Auth', 'Tasks', 'Workflow', 'API surface', 'Docs'];

const SUMMARY_TEMPLATES: Array<(pr: PullRequest) => string> = [
    pr => `${pr.title} reorganizes the affected module while preserving public API. The shape is sound; one targeted regression test would push this above the merge bar.`,
    pr => `This PR carries the bulk of the change in a small number of files. AI flagged two narrow questions on cancellation behavior; the rest is mechanical and safe to skim.`,
    pr => `${pr.title} touches a hot path. AI recommends focusing review on boundary conditions and abort handling before approving.`,
];

function buildAiSummary(pr: PullRequest, seed: number): AiSummary {
    const risk = inferRisk(pr, seed);
    const reviewTime = pickFromList(REVIEW_TIMES, seed, 1);
    const impact = pickFromList(IMPACT_LABELS, seed, 2);
    const summaryFn = pickFromList(SUMMARY_TEMPLATES, seed, 3);
    const confidence = 70 + (seed % 25);

    const findings: AiFinding[] = [
        {
            tag: 'good',
            label: 'Good',
            body: 'Module boundaries are isolated; no shared mutable state introduced across the new code paths.',
        },
        {
            tag: 'risk',
            label: 'Risk',
            body: 'Abort handling closes the underlying reader but does not flush the trailing partial record. A retry can replay the final entry.',
        },
        {
            tag: 'note',
            label: 'Note',
            body: 'Docs mention the new feature flag, but the rollout owner is not assigned in the PR body.',
        },
    ];

    return {
        risk,
        confidence,
        summary: summaryFn(pr),
        blockingThreadCount: 1 + (seed % 3),
        unresolvedCount: 1 + ((seed + 1) % 4),
        metrics: [
            { key: 'Risk', value: risk },
            { key: 'Review time', value: reviewTime },
            { key: 'Impact', value: impact },
            { key: 'Confidence', value: `${confidence}%` },
        ],
        findings,
    };
}

const PERSONA_LENSES: PersonaLens[] = [
    {
        persona: 'Reviewer',
        body: 'Start with the parser boundary and abort path. AI estimates the review can skip generated fixtures and focus on 5 files.',
    },
    {
        persona: 'Author',
        body: 'Resolve two grouped questions, add the slow-consumer test, and update the rollout owner before requesting re-review.',
    },
    {
        persona: 'Tech lead',
        body: 'Safe behind ingest_streaming_v2; merge can proceed after coverage confirms retry behavior.',
    },
];

const TIMELINE_EVENTS: AiTimelineEvent[] = [
    {
        initials: 'AI',
        kind: 'ai',
        title: 'AI grouped 12 review threads into 4 topics.',
        detail: 'Backpressure, retry semantics, documentation, and generated fixture noise.',
    },
    {
        initials: 'JL',
        kind: 'reviewer',
        title: 'Jordan Lee requested a cancellation test.',
        detail: '"Can we prove abort does not replay the final partial line?"',
    },
    {
        initials: 'MA',
        kind: 'author',
        title: 'Morgan Ames pushed 3 commits.',
        detail: 'Added parser boundary docs and replaced the old batch fixture helper.',
    },
];

const THREAD_GROUPS: AiThreadGroup[] = [
    {
        id: 'backpressure',
        title: 'Backpressure and aborts',
        count: 5,
        severity: 'blocking',
        body: 'Blocking. Needs one slow-consumer retry test and explicit partial-line handling.',
    },
    {
        id: 'compatibility',
        title: 'API compatibility',
        count: 3,
        severity: 'non-blocking',
        body: 'Non-blocking. Public options preserve defaults, but release notes should name the flag.',
    },
    {
        id: 'fixtures',
        title: 'Generated fixtures',
        count: 2,
        severity: 'noise',
        body: 'Noise. AI recommends hiding generated diff by default for reviewers.',
    },
    {
        id: 'docs',
        title: 'Docs and ownership',
        count: 2,
        severity: 'blocking',
        body: 'Blocking. Rollout owner missing from PR checklist.',
    },
];

const COMMIT_TEMPLATES: AiCommitRow[] = [
    {
        id: 'c1',
        title: 'stream JSONL parser behind feature flag',
        intent: 'feat',
        note: 'Core behavior change; review first.',
        hash: 'a81c9e2',
    },
    {
        id: 'c2',
        title: 'replace batch fixture helper',
        intent: 'test',
        note: 'Generated diff can be hidden during review.',
        hash: '44dd19b',
    },
    {
        id: 'c3',
        title: 'document ingest_streaming_v2 rollout',
        intent: 'docs',
        note: 'Owner field still blank.',
        hash: 'bb70fe3',
    },
    {
        id: 'c4',
        title: 'wire cancellation into worker shutdown',
        intent: 'fix',
        note: 'Touches retry behavior; needs focused test.',
        hash: 'd0217ac',
    },
    {
        id: 'c5',
        title: 'remove legacy offset cache',
        intent: 'refactor',
        note: 'Safe if parser isolation holds.',
        hash: '9ef4481',
    },
];

const CHECK_TEMPLATES: AiCheckRow[] = [
    {
        id: 'unit',
        name: 'unit / ingest',
        status: 'ok',
        duration: '3m 18s',
        interpretation: 'Relevant but missing abort scenario.',
    },
    {
        id: 'integration',
        name: 'integration / worker',
        status: 'ok',
        duration: '7m 04s',
        interpretation: 'Covers batch mode and streaming flag enabled.',
    },
    {
        id: 'typecheck',
        name: 'typecheck',
        status: 'ok',
        duration: '1m 46s',
        interpretation: 'No public API type break detected.',
    },
    {
        id: 'coverage',
        name: 'coverage',
        status: 'warn',
        duration: '2m 11s',
        interpretation: 'Coverage passed, but the changed branch lacks a slow-consumer path.',
    },
    {
        id: 'docs',
        name: 'docs preview',
        status: 'ok',
        duration: '0m 44s',
        interpretation: 'Docs build; rollout owner remains a content issue.',
    },
];

const MERGE_READINESS: MergeReadinessItem[] = [
    {
        tag: 'good',
        label: 'Pass',
        body: 'All required checks completed successfully.',
    },
    {
        tag: 'risk',
        label: 'Block',
        body: 'Add cancellation test for a slow consumer and partial UTF-8 boundary.',
    },
    {
        tag: 'note',
        label: 'Next',
        body: 'Assign rollout owner in docs/ingest-streaming.md.',
    },
];

const FILES: AiFileEntry[] = [
    {
        path: 'packages/ingest/src/jsonl-stream.ts',
        additions: 164,
        deletions: 18,
        focus: 'AI focus file',
        diff: [
            { line: 84, kind: 'ctx', text: 'export async function readJsonlStream(source, options) {' },
            { line: 85, kind: 'add', text: '  const decoder = new TextDecoder();' },
            { line: 86, kind: 'add', text: '  let buffered = "";' },
            { line: 87, kind: 'add', text: '  for await (const chunk of source) {' },
            { line: 88, kind: 'add', text: '    buffered += decoder.decode(chunk, { stream: true });' },
            { line: 89, kind: 'add', text: '    yield* parseCompleteLines(buffered, options);' },
            { line: 90, kind: 'ctx', text: '  }' },
        ],
        annotation: {
            title: 'AI annotation: possible replay on abort',
            body: 'If the stream aborts after line 88 and before line 89, `buffered` can contain a partial record that the retry path replays. Add a test for abort after a split UTF-8 boundary.',
            actions: ['Apply suggested test', 'Reply'],
        },
    },
    {
        path: 'packages/ingest/src/worker.ts',
        additions: 72,
        deletions: 44,
    },
    {
        path: 'packages/ingest/test/jsonl-stream.test.ts',
        additions: 211,
        deletions: 0,
        focus: 'Coverage gap',
        diff: [
            { line: 121, kind: 'ctx', text: 'it("streams large JSONL payloads without buffering the full file", async () => {' },
            { line: 122, kind: 'add', text: '  const rows = await collect(readJsonlStream(makeLargeFixture()));' },
            { line: 123, kind: 'add', text: '  expect(rows).toHaveLength(5000);' },
            { line: 124, kind: 'ctx', text: '});' },
        ],
        annotation: {
            title: 'AI annotation: test shape is useful but too happy-path',
            body: 'This validates memory behavior, not cancellation semantics. Keep it, then add one test with a slow reader and an aborted consumer.',
            actions: ['Create task'],
        },
    },
    {
        path: 'docs/ingest-streaming.md',
        additions: 54,
        deletions: 6,
    },
    {
        path: 'fixtures/generated/jsonl-large.fixture',
        additions: 346,
        deletions: 0,
        focus: 'Generated',
    },
];

const SUGGESTED_PROMPTS: AiSuggestedPrompt[] = [
    {
        id: 'review-first',
        label: 'What should I review first?',
        answer: 'Start with jsonl-stream.ts and the worker cancellation path. The generated fixture and docs changes are low review value unless you are checking rollout copy.',
        sources: ['jsonl-stream.ts:84', 'worker.ts:211', 'checks/coverage'],
    },
    {
        id: 'draft-comment',
        label: 'Draft the smallest blocking comment.',
        answer: 'Blocking comment draft: "Please add a slow-consumer cancellation test where a JSONL record is split across chunks, then abort before parseCompleteLines runs. I want to confirm retry does not replay the trailing partial line."',
        sources: ['threads/backpressure', 'jsonl-stream.ts:88'],
    },
    {
        id: 'safe-to-ignore',
        label: 'What can safely be ignored?',
        answer: 'You can safely skim the generated fixture and most docs wording. They do not change runtime behavior; focus review time on parser state, cancellation, and worker retry.',
        sources: ['fixtures/generated/jsonl-large.fixture', 'docs/ingest-streaming.md'],
    },
];

const SEED_CHAT: AiChatMessage[] = [
    {
        id: 'm1',
        role: 'ai',
        body: 'Start with jsonl-stream.ts and the worker cancellation path. The generated fixture and docs changes are low review value unless you are checking rollout copy.',
        sources: ['jsonl-stream.ts:84', 'worker.ts:211', 'checks/coverage'],
    },
    {
        id: 'm2',
        role: 'user',
        body: 'Can this merge today?',
    },
    {
        id: 'm3',
        role: 'ai',
        body: 'Yes, after one targeted test and a docs owner update. I would not block on the generated fixture diff or minor naming comments.',
        sources: ['threads/backpressure', 'docs/ingest-streaming.md'],
    },
];

export function getMockAiSummary(pr: PullRequest): AiSummary {
    const seed = hashString(`${pr.id}|${pr.title}`);
    return buildAiSummary(pr, seed);
}

export function getMockPersonaLenses(): PersonaLens[] {
    return PERSONA_LENSES;
}

export function getMockTimeline(): AiTimelineEvent[] {
    return TIMELINE_EVENTS;
}

export function getMockThreadGroups(): AiThreadGroup[] {
    return THREAD_GROUPS;
}

export function getMockCommitRows(): AiCommitRow[] {
    return COMMIT_TEMPLATES;
}

export function getMockCheckRows(): AiCheckRow[] {
    return CHECK_TEMPLATES;
}

export function getMockMergeReadiness(): MergeReadinessItem[] {
    return MERGE_READINESS;
}

export function getMockFiles(): AiFileEntry[] {
    return FILES;
}

export function getMockSuggestedPrompts(): AiSuggestedPrompt[] {
    return SUGGESTED_PROMPTS;
}

export function getMockSeedChat(): AiChatMessage[] {
    return SEED_CHAT.map(message => ({ ...message }));
}

const FALLBACK_AI_REPLIES: Array<{ test: RegExp; answer: string; sources?: string[] }> = [
    {
        test: /ignore|skip/i,
        answer:
            'You can safely skim the generated fixture and most docs wording. They do not change runtime behavior; focus review time on parser state, cancellation, and worker retry.',
        sources: ['fixtures/generated/jsonl-large.fixture', 'docs/ingest-streaming.md'],
    },
    {
        test: /draft|comment|message/i,
        answer:
            'Blocking comment draft: "Please add a slow-consumer cancellation test where a JSONL record is split across chunks, then abort before parseCompleteLines runs. I want to confirm retry does not replay the trailing partial line."',
        sources: ['threads/backpressure', 'jsonl-stream.ts:88'],
    },
    {
        test: /merge|today|ship/i,
        answer:
            'Yes, after one targeted test and a docs owner update. I would not block on the generated fixture diff or minor naming comments.',
        sources: ['threads/backpressure', 'docs/ingest-streaming.md'],
    },
];

export function getMockAiAnswer(question: string): { answer: string; sources?: string[] } {
    for (const entry of FALLBACK_AI_REPLIES) {
        if (entry.test.test(question)) {
            return { answer: entry.answer, sources: entry.sources };
        }
    }
    return {
        answer:
            'The highest-value action is to review the stream abort boundary, then ask the author for one focused test. The rest can move after the rollout owner is named.',
        sources: ['jsonl-stream.ts:88', 'threads/backpressure'],
    };
}

export function getMockBranchSnapshot(pr: PullRequest): AiBranchSnapshot {
    const seed = hashString(`${pr.id}|${pr.targetBranch}|${pr.sourceBranch}`);
    return {
        sourceBranch: pr.sourceBranch,
        targetBranch: pr.targetBranch,
        additions: 200 + (seed % 700),
        deletions: 20 + ((seed >> 4) % 250),
        commitCount: 4 + (seed % 12),
        fileCount: 3 + ((seed >> 8) % 45),
    };
}

export function getMockReviewSummaryText(pr: PullRequest): string {
    return getMockAiSummary(pr).summary;
}

// ──────────────────────────────────────────────────────────────────────────────
// Queue/list helpers (left rail)
// ──────────────────────────────────────────────────────────────────────────────

export type QueueFilter = 'all' | 'mine' | 'blocked' | 'ready';
export type QueueDotState = 'open' | 'draft' | 'blocked' | 'ready';
export type QueueRiskBadge = 'low' | 'med' | 'high';

export function getMockPrFileCount(pr: PullRequest): number {
    const seed = hashString(`${pr.id}|files`);
    return 2 + (seed % 60);
}

export function getMockPrReviewMinutes(pr: PullRequest): number {
    const seed = hashString(`${pr.id}|time`);
    return 2 + (seed % 40);
}

export function getMockQueueRisk(pr: PullRequest): QueueRiskBadge {
    switch (getMockAiSummary(pr).risk) {
        case 'Low':    return 'low';
        case 'Medium': return 'med';
        case 'High':   return 'high';
    }
}

export function queueRiskClass(risk: QueueRiskBadge): string {
    switch (risk) {
        case 'low':  return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200';
        case 'med':  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200';
        case 'high': return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200';
    }
}

export function queueDotClass(state: QueueDotState): string {
    switch (state) {
        case 'open':
            return 'border-2 border-green-600 dark:border-green-500';
        case 'draft':
            return 'border-2 border-gray-500 bg-gray-500';
        case 'blocked':
            return 'border-2 border-yellow-600 bg-yellow-600 dark:border-yellow-500 dark:bg-yellow-500';
        case 'ready':
            return 'border-2 border-purple-600 bg-purple-600 dark:border-purple-400 dark:bg-purple-400';
    }
}

export interface QueueFilterCounts {
    all: number;
    mine: number;
    blocked: number;
    ready: number;
}

const ALL_FILTERS: QueueFilter[] = ['all', 'mine', 'blocked', 'ready'];

export function getQueueFilterDefinitions(): Array<{ id: QueueFilter; label: string }> {
    return [
        { id: 'all',     label: 'All' },
        { id: 'mine',    label: 'Mine' },
        { id: 'blocked', label: 'Blocked' },
        { id: 'ready',   label: 'Ready' },
    ];
}

export { ALL_FILTERS as QUEUE_FILTERS };

