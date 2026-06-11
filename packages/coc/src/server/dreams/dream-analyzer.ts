import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import type { DreamInternalProcessPurpose, DreamInternalStepRunner } from './dream-internal-process';
import { prefilterDreamCandidate } from './dream-store';
import type {
    CreateDreamCandidateInput,
    DreamCard,
    DreamSourceRange,
} from './types';
import { DREAM_CARD_CATEGORIES } from './types';
import type { DreamConversationSelection } from './dream-source-selector';

export const DEFAULT_DREAM_ANALYSIS_TIMEOUT_MS = 3_600_000;
export const DEFAULT_DREAM_CONFIDENCE_THRESHOLD = 0.85;
export const DEFAULT_DREAM_MAX_CANDIDATES = 8;

const ANALYZER_SYSTEM_PROMPT = `\
You are the CoC Dream analyzer.

Your job is to inspect completed workspace conversations and propose only high-confidence improvement opportunities as dream card candidates.

STRICT OUTPUT CONTRACT
======================
Respond with ONLY a valid JSON object. No prose, no markdown, no code fences.

Schema:
{
  "candidates": [
    {
      "category": "skill-or-prompt-improvement" | "user-workflow-suggestion" | "product-improvement",
      "sourceRanges": [
        { "processId": "process-id", "startTurnIndex": 0, "endTurnIndex": 2 }
      ],
      "observedPattern": "Quote-free summary of the observed pattern.",
      "whyItMatters": "Why this pattern matters.",
      "recommendation": "Concrete recommendation.",
      "expectedImpact": "Expected impact if acted on.",
      "confidence": 0.0,
      "notAlreadyCoveredRationale": "Why this is not already covered by obvious existing behavior."
    }
  ]
}

Rules:
- Optimize for precision over recall. Return an empty candidates array when evidence is weak.
- Use exactly these categories: ${DREAM_CARD_CATEGORIES.join(', ')}.
- Source ranges must reference only process IDs and turn ranges supplied in the prompt.
- Do not quote user or assistant text. Summarize observed patterns without direct quotes.
- Do not recommend direct mutations. Dream cards are review prompts only.
- Drop vague, speculative, duplicate, unactionable, or low-confidence ideas.
`.trim();

const CRITIC_SYSTEM_PROMPT = `\
You are the CoC Dream critic and dedup validator.

Your job is to validate candidate dream cards before they become visible.

STRICT OUTPUT CONTRACT
======================
Respond with ONLY a valid JSON object. No prose, no markdown, no code fences.

Schema:
{
  "decisions": [
    {
      "candidateIndex": 0,
      "verdict": "accept" | "reject" | "duplicate",
      "rationale": "Concrete reason for the decision.",
      "dedupRationale": "Required when verdict is duplicate; optional otherwise.",
      "duplicateOfCardId": "prior-card-id"
    }
  ]
}

Rules:
- Accept only candidates with concrete source evidence, actionable recommendations, and high expected value.
- Reject vague, speculative, low-evidence, low-impact, or already-covered candidates.
- Mark as duplicate when the candidate is materially covered by prior dream cards, active work items, or skill-hardening records.
- Prefer rejection over showing a questionable card.
`.trim();

type CriticVerdict = 'accept' | 'reject' | 'duplicate';

export interface DreamRelatedRecord {
    kind: 'dream-card' | 'work-item' | 'skill-hardening-record';
    id: string;
    status?: string;
    title?: string;
    summary: string;
    recommendation?: string;
    dedupFingerprint?: string;
}

export interface DreamAnalysisPolicy {
    confidenceThreshold?: number;
    maxCandidates?: number;
}

export interface DreamAnalyzerOptions extends DreamAnalysisPolicy {
    runInternalStep: DreamInternalStepRunner;
    workspaceId: string;
    runId?: string;
    parentProcessId?: string;
    selection: DreamConversationSelection;
    existingCards?: readonly DreamCard[];
    relatedRecords?: readonly DreamRelatedRecord[];
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: ReasoningEffort;
    timeoutMs?: number;
    signal?: AbortSignal;
    onInternalProcessStarted?: (purpose: DreamInternalProcessPurpose, processId: string) => void;
}

export interface NormalizedDreamAnalysisCandidate {
    candidate: CreateDreamCandidateInput & { dedupFingerprint: string };
    originalIndex: number;
}

export interface DreamAnalysisRejection {
    stage: 'prefilter' | 'critic';
    candidateIndex: number;
    reason: string;
    dedupFingerprint?: string;
    duplicateOfCardId?: string;
}

export interface DreamCriticDecision {
    candidateIndex: number;
    verdict: CriticVerdict;
    rationale: string;
    dedupRationale?: string;
    duplicateOfCardId?: string;
}

export interface DreamValidatedCandidate extends NormalizedDreamAnalysisCandidate {
    criticRationale: string;
    dedupRationale?: string;
}

export interface DreamCandidateNormalizationResult {
    candidates: NormalizedDreamAnalysisCandidate[];
    rejected: DreamAnalysisRejection[];
    rawCandidateCount: number;
}

export interface DreamAnalysisResult {
    analyzerProcessId?: string;
    criticProcessId?: string;
    candidates: DreamValidatedCandidate[];
    rejected: DreamAnalysisRejection[];
    rawCandidateCount: number;
    deterministicCandidateCount: number;
    sourceRanges: DreamSourceRange[];
}

interface ParseCandidateOptions extends DreamAnalysisPolicy {
    workspaceId: string;
    runId?: string;
    allowedSourceRanges: readonly DreamSourceRange[];
}

function stripCodeFences(raw: string): string {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
    return fenced ? fenced[1].trim() : trimmed;
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
    const jsonText = stripCodeFences(raw);
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new Error(`AI returned non-JSON ${label}: ${raw.slice(0, 200)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`AI ${label} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
}

function clampConfidenceThreshold(value: number | undefined): number {
    if (value === undefined) return DEFAULT_DREAM_CONFIDENCE_THRESHOLD;
    if (!Number.isFinite(value)) return DEFAULT_DREAM_CONFIDENCE_THRESHOLD;
    return Math.min(1, Math.max(0, value));
}

function clampMaxCandidates(value: number | undefined): number {
    if (value === undefined) return DEFAULT_DREAM_MAX_CANDIDATES;
    if (!Number.isFinite(value)) return DEFAULT_DREAM_MAX_CANDIDATES;
    return Math.max(1, Math.trunc(value));
}

function isRangeContained(range: DreamSourceRange, allowedRange: DreamSourceRange): boolean {
    return range.processId === allowedRange.processId
        && range.startTurnIndex >= allowedRange.startTurnIndex
        && range.endTurnIndex <= allowedRange.endTurnIndex;
}

function assertSourceRangesAllowed(
    sourceRanges: readonly DreamSourceRange[],
    allowedSourceRanges: readonly DreamSourceRange[],
): string | undefined {
    const invalid = sourceRanges.find(range =>
        !allowedSourceRanges.some(allowedRange => isRangeContained(range, allowedRange))
    );
    return invalid
        ? `source range ${invalid.processId}:${invalid.startTurnIndex}-${invalid.endTurnIndex} was not in the eligible source selection`
        : undefined;
}

function flattenSelectionSourceRanges(selection: DreamConversationSelection): DreamSourceRange[] {
    return selection.conversations.flatMap(conversation => conversation.sourceRanges);
}

function truncateForPrompt(value: string, maxChars = 2_000): string {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars - 16)}\n[truncated]`;
}

function formatSourceRanges(ranges: readonly DreamSourceRange[]): string {
    return ranges
        .map(range => `${range.processId}:${range.startTurnIndex}-${range.endTurnIndex}`)
        .join(', ');
}

function formatSelectionForPrompt(selection: DreamConversationSelection): string {
    return selection.conversations.map((conversation, index) => {
        const title = conversation.title?.trim() || conversation.promptPreview || conversation.processId;
        const turns = conversation.turns.map(turn =>
            `  - turn ${turn.turnIndex} (${turn.role}, ${turn.timestamp}): ${truncateForPrompt(turn.content)}`
        ).join('\n');
        return [
            `Conversation ${index + 1}`,
            `processId: ${conversation.processId}`,
            `title: ${title}`,
            `activityAt: ${conversation.activityAt}`,
            `eligibleSourceRanges: ${formatSourceRanges(conversation.sourceRanges)}`,
            'visibleUncoveredTurns:',
            turns,
        ].join('\n');
    }).join('\n\n---\n\n');
}

export function buildDreamAnalysisPrompt(options: {
    workspaceId: string;
    runId?: string;
    selection: DreamConversationSelection;
    policy?: DreamAnalysisPolicy;
}): string {
    const confidenceThreshold = clampConfidenceThreshold(options.policy?.confidenceThreshold);
    const maxCandidates = clampMaxCandidates(options.policy?.maxCandidates);
    return [
        `Workspace ID: ${options.workspaceId}`,
        ...(options.runId ? [`Dream run ID: ${options.runId}`] : []),
        `Minimum confidence for candidates: ${confidenceThreshold}`,
        `Maximum candidates to return: ${maxCandidates}`,
        `Scanned completed processes: ${options.selection.scannedProcessCount}`,
        `Skipped selection counts: ${JSON.stringify(options.selection.skipped)}`,
        '',
        'Eligible source conversations:',
        formatSelectionForPrompt(options.selection),
    ].join('\n');
}

function buildExistingCardRecords(cards: readonly DreamCard[]): DreamRelatedRecord[] {
    return cards.map(card => ({
        kind: 'dream-card',
        id: card.id,
        status: card.status,
        title: card.observedPattern,
        summary: card.whyItMatters,
        recommendation: card.recommendation,
        dedupFingerprint: card.dedupFingerprint,
    }));
}

function formatRelatedRecords(records: readonly DreamRelatedRecord[]): string {
    if (records.length === 0) {
        return 'None provided.';
    }
    return records.map((record, index) => {
        const fields = [
            `Record ${index + 1}`,
            `kind: ${record.kind}`,
            `id: ${record.id}`,
            ...(record.status ? [`status: ${record.status}`] : []),
            ...(record.title ? [`title: ${record.title}`] : []),
            ...(record.dedupFingerprint ? [`dedupFingerprint: ${record.dedupFingerprint}`] : []),
            `summary: ${record.summary}`,
            ...(record.recommendation ? [`recommendation: ${record.recommendation}`] : []),
        ];
        return fields.join('\n');
    }).join('\n\n');
}

export function buildDreamCriticPrompt(options: {
    candidates: readonly NormalizedDreamAnalysisCandidate[];
    existingCards?: readonly DreamCard[];
    relatedRecords?: readonly DreamRelatedRecord[];
}): string {
    const records = [
        ...buildExistingCardRecords(options.existingCards ?? []),
        ...(options.relatedRecords ?? []),
    ];
    const candidateBlock = options.candidates.map(candidate => {
        const c = candidate.candidate;
        return [
            `Candidate index: ${candidate.originalIndex}`,
            `category: ${c.category}`,
            `dedupFingerprint: ${c.dedupFingerprint}`,
            `sourceRanges: ${formatSourceRanges(c.sourceRanges)}`,
            `observedPattern: ${c.observedPattern}`,
            `whyItMatters: ${c.whyItMatters}`,
            `recommendation: ${c.recommendation}`,
            `expectedImpact: ${c.expectedImpact}`,
            `confidence: ${c.confidence}`,
            `notAlreadyCoveredRationale: ${c.notAlreadyCoveredRationale}`,
        ].join('\n');
    }).join('\n\n---\n\n');
    return [
        'Candidate dream cards to validate:',
        candidateBlock,
        '',
        'Existing dream cards, active work items, and skill-hardening records to deduplicate against:',
        formatRelatedRecords(records),
    ].join('\n');
}

export function normalizeDreamAnalysisCandidates(
    raw: string,
    options: ParseCandidateOptions,
): DreamCandidateNormalizationResult {
    const obj = parseJsonObject(raw, 'Dream analysis response');
    const rawCandidates = obj.candidates;
    if (!Array.isArray(rawCandidates)) {
        throw new Error('AI Dream analysis response must include a candidates array');
    }

    const confidenceThreshold = clampConfidenceThreshold(options.confidenceThreshold);
    const maxCandidates = clampMaxCandidates(options.maxCandidates);
    const candidates: NormalizedDreamAnalysisCandidate[] = [];
    const rejected: DreamAnalysisRejection[] = [];

    rawCandidates.forEach((rawCandidate, index) => {
        if (!rawCandidate || typeof rawCandidate !== 'object' || Array.isArray(rawCandidate)) {
            rejected.push({
                stage: 'prefilter',
                candidateIndex: index,
                reason: 'candidate must be an object',
            });
            return;
        }
        const candidateRecord = rawCandidate as Record<string, unknown>;
        const candidateInput = {
            workspaceId: options.workspaceId,
            ...(options.runId ? { runId: options.runId } : {}),
            category: candidateRecord.category,
            sourceRanges: candidateRecord.sourceRanges,
            observedPattern: candidateRecord.observedPattern,
            whyItMatters: candidateRecord.whyItMatters,
            recommendation: candidateRecord.recommendation,
            expectedImpact: candidateRecord.expectedImpact,
            confidence: candidateRecord.confidence,
            dedupFingerprint: candidateRecord.dedupFingerprint,
            notAlreadyCoveredRationale: candidateRecord.notAlreadyCoveredRationale,
        } as CreateDreamCandidateInput;

        const prefilter = prefilterDreamCandidate(candidateInput);
        if (!prefilter.accepted) {
            rejected.push({
                stage: 'prefilter',
                candidateIndex: index,
                reason: prefilter.reasons.join('; '),
            });
            return;
        }

        if (prefilter.candidate.confidence < confidenceThreshold) {
            rejected.push({
                stage: 'prefilter',
                candidateIndex: index,
                reason: `confidence ${prefilter.candidate.confidence} is below threshold ${confidenceThreshold}`,
                dedupFingerprint: prefilter.candidate.dedupFingerprint,
            });
            return;
        }

        const sourceError = assertSourceRangesAllowed(prefilter.candidate.sourceRanges, options.allowedSourceRanges);
        if (sourceError) {
            rejected.push({
                stage: 'prefilter',
                candidateIndex: index,
                reason: sourceError,
                dedupFingerprint: prefilter.candidate.dedupFingerprint,
            });
            return;
        }

        if (candidates.length >= maxCandidates) {
            rejected.push({
                stage: 'prefilter',
                candidateIndex: index,
                reason: `candidate limit ${maxCandidates} already reached`,
                dedupFingerprint: prefilter.candidate.dedupFingerprint,
            });
            return;
        }

        candidates.push({
            candidate: prefilter.candidate,
            originalIndex: index,
        });
    });

    return {
        candidates,
        rejected,
        rawCandidateCount: rawCandidates.length,
    };
}

function isCriticVerdict(value: unknown): value is CriticVerdict {
    return value === 'accept' || value === 'reject' || value === 'duplicate';
}

export function parseDreamCriticResponse(raw: string): DreamCriticDecision[] {
    const obj = parseJsonObject(raw, 'Dream critic response');
    const decisions = obj.decisions;
    if (!Array.isArray(decisions)) {
        throw new Error('AI Dream critic response must include a decisions array');
    }

    return decisions.map((rawDecision, index): DreamCriticDecision => {
        if (!rawDecision || typeof rawDecision !== 'object' || Array.isArray(rawDecision)) {
            throw new Error(`critic decisions[${index}] must be an object`);
        }
        const decision = rawDecision as Record<string, unknown>;
        const candidateIndex = decision.candidateIndex;
        if (!Number.isInteger(candidateIndex) || (candidateIndex as number) < 0) {
            throw new Error(`critic decisions[${index}].candidateIndex must be a non-negative integer`);
        }
        if (!isCriticVerdict(decision.verdict)) {
            throw new Error(`critic decisions[${index}].verdict must be accept, reject, or duplicate`);
        }
        const rationale = typeof decision.rationale === 'string' ? decision.rationale.trim() : '';
        if (!rationale) {
            throw new Error(`critic decisions[${index}].rationale is required`);
        }
        const dedupRationale = typeof decision.dedupRationale === 'string' && decision.dedupRationale.trim()
            ? decision.dedupRationale.trim()
            : undefined;
        const duplicateOfCardId = typeof decision.duplicateOfCardId === 'string' && decision.duplicateOfCardId.trim()
            ? decision.duplicateOfCardId.trim()
            : undefined;
        if (decision.verdict === 'duplicate' && !dedupRationale) {
            throw new Error(`critic decisions[${index}].dedupRationale is required for duplicate verdicts`);
        }
        return {
            candidateIndex: candidateIndex as number,
            verdict: decision.verdict,
            rationale,
            ...(dedupRationale ? { dedupRationale } : {}),
            ...(duplicateOfCardId ? { duplicateOfCardId } : {}),
        };
    });
}

function applyCriticDecisions(
    candidates: readonly NormalizedDreamAnalysisCandidate[],
    decisions: readonly DreamCriticDecision[],
): { accepted: DreamValidatedCandidate[]; rejected: DreamAnalysisRejection[] } {
    const decisionsByIndex = new Map(decisions.map(decision => [decision.candidateIndex, decision]));
    const accepted: DreamValidatedCandidate[] = [];
    const rejected: DreamAnalysisRejection[] = [];

    for (const candidate of candidates) {
        const decision = decisionsByIndex.get(candidate.originalIndex);
        if (!decision) {
            rejected.push({
                stage: 'critic',
                candidateIndex: candidate.originalIndex,
                reason: 'critic omitted a decision for this candidate',
                dedupFingerprint: candidate.candidate.dedupFingerprint,
            });
            continue;
        }
        if (decision.verdict === 'accept') {
            accepted.push({
                ...candidate,
                candidate: {
                    ...candidate.candidate,
                    criticRationale: decision.rationale,
                    ...(decision.dedupRationale ? { dedupRationale: decision.dedupRationale } : {}),
                },
                criticRationale: decision.rationale,
                ...(decision.dedupRationale ? { dedupRationale: decision.dedupRationale } : {}),
            });
            continue;
        }

        rejected.push({
            stage: 'critic',
            candidateIndex: candidate.originalIndex,
            reason: decision.rationale,
            dedupFingerprint: candidate.candidate.dedupFingerprint,
            ...(decision.duplicateOfCardId ? { duplicateOfCardId: decision.duplicateOfCardId } : {}),
        });
    }

    return { accepted, rejected };
}

export async function analyzeDreamConversations(options: DreamAnalyzerOptions): Promise<DreamAnalysisResult> {
    const workspaceId = options.workspaceId.trim();
    if (!workspaceId) {
        throw new Error('workspaceId is required');
    }
    if (options.selection.workspaceId !== workspaceId) {
        throw new Error(`Dream selection workspace '${options.selection.workspaceId}' does not match '${workspaceId}'`);
    }

    const sourceRanges = flattenSelectionSourceRanges(options.selection);
    if (options.selection.conversations.length === 0 || sourceRanges.length === 0) {
        return {
            candidates: [],
            rejected: [],
            rawCandidateCount: 0,
            deterministicCandidateCount: 0,
            sourceRanges,
        };
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_DREAM_ANALYSIS_TIMEOUT_MS;
    const policy: DreamAnalysisPolicy = {
        confidenceThreshold: options.confidenceThreshold,
        maxCandidates: options.maxCandidates,
    };
    const analysisPrompt = buildDreamAnalysisPrompt({
        workspaceId,
        runId: options.runId,
        selection: options.selection,
        policy,
    });
    const analysisStep = await options.runInternalStep({
        purpose: 'analyzer',
        workspaceId,
        runId: options.runId ?? 'dream-run',
        prompt: analysisPrompt,
        systemPrompt: ANALYZER_SYSTEM_PROMPT,
        timeoutMs,
        ...(options.parentProcessId ? { parentProcessId: options.parentProcessId } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        onProcessStarted: processId => options.onInternalProcessStarted?.('analyzer', processId),
    });
    const analysisResponse = analysisStep.response;
    const analyzerProcessId = analysisStep.processId;
    options.onInternalProcessStarted?.('analyzer', analyzerProcessId);
    const normalized = normalizeDreamAnalysisCandidates(analysisResponse, {
        workspaceId,
        ...(options.runId ? { runId: options.runId } : {}),
        allowedSourceRanges: sourceRanges,
        confidenceThreshold: options.confidenceThreshold,
        maxCandidates: options.maxCandidates,
    });

    if (normalized.candidates.length === 0) {
        return {
            analyzerProcessId,
            candidates: [],
            rejected: normalized.rejected,
            rawCandidateCount: normalized.rawCandidateCount,
            deterministicCandidateCount: 0,
            sourceRanges,
        };
    }

    const criticPrompt = buildDreamCriticPrompt({
        candidates: normalized.candidates,
        existingCards: options.existingCards,
        relatedRecords: options.relatedRecords,
    });
    const criticStep = await options.runInternalStep({
        purpose: 'critic',
        workspaceId,
        runId: options.runId ?? 'dream-run',
        analyzerProcessId,
        prompt: criticPrompt,
        systemPrompt: CRITIC_SYSTEM_PROMPT,
        timeoutMs,
        ...(options.parentProcessId ? { parentProcessId: options.parentProcessId } : {}),
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        onProcessStarted: processId => options.onInternalProcessStarted?.('critic', processId),
    });
    options.onInternalProcessStarted?.('critic', criticStep.processId);
    const decisions = parseDreamCriticResponse(criticStep.response);
    const critic = applyCriticDecisions(normalized.candidates, decisions);

    return {
        analyzerProcessId,
        criticProcessId: criticStep.processId,
        candidates: critic.accepted,
        rejected: [...normalized.rejected, ...critic.rejected],
        rawCandidateCount: normalized.rawCandidateCount,
        deterministicCandidateCount: normalized.candidates.length,
        sourceRanges,
    };
}
