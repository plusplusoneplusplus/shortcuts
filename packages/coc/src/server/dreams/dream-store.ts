import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { atomicWriteJSON } from '../shared/fs-utils';
import type {
    CompleteDreamRunInput,
    CreateDreamRunInput,
    CreateDreamCandidateInput,
    DreamCard,
    DreamCardCategory,
    DreamCardListOptions,
    DreamCardStatus,
    DreamConversionLink,
    DreamDismissOptions,
    DreamPromotionOptions,
    DreamRunRecord,
    DreamRunStatus,
    DreamSourceRange,
    DreamSupersedeOptions,
    FailDreamRunInput,
} from './types';
import type { ChatProvider, ReasoningEffort } from '../tasks/task-types';
import {
    DREAM_CARD_CATEGORIES,
    DREAM_CARD_STATUSES,
    DREAM_REVIEW_VISIBLE_STATUSES,
    DREAM_RUN_STATUSES,
} from './types';

interface StoredDreamCardsFile {
    version: 1;
    cards: DreamCard[];
}

interface StoredDreamRunsFile {
    version: 1;
    runs: DreamRunRecord[];
}

export interface FileDreamStoreOptions {
    dataDir: string;
}

interface NormalizedDreamCandidate extends Omit<CreateDreamCandidateInput, 'dedupFingerprint'> {
    dedupFingerprint: string;
}

export type DreamCandidatePrefilterResult =
    | { accepted: true; candidate: NormalizedDreamCandidate }
    | { accepted: false; reasons: string[] };

const CARD_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const REQUIRED_TEXT_MIN_LENGTH = 8;
const FINGERPRINT_MAX_LENGTH = 200;

function mintCardId(): string {
    return `dream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mintRunId(): string {
    return `dream-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function assertCardId(cardId: string): string {
    if (!CARD_ID_PATTERN.test(cardId)) {
        throw new Error(`Invalid dream card ID: ${cardId}`);
    }
    return cardId;
}

function isDreamCategory(value: unknown): value is DreamCardCategory {
    return typeof value === 'string' && (DREAM_CARD_CATEGORIES as readonly string[]).includes(value);
}

function isDreamStatus(value: unknown): value is DreamCardStatus {
    return typeof value === 'string' && (DREAM_CARD_STATUSES as readonly string[]).includes(value);
}

function isDreamRunStatus(value: unknown): value is DreamRunStatus {
    return typeof value === 'string' && (DREAM_RUN_STATUSES as readonly string[]).includes(value);
}

function normalizeRequiredText(value: unknown, label: string, reasons: string[]): string {
    if (typeof value !== 'string') {
        reasons.push(`${label} is required`);
        return '';
    }
    const trimmed = value.trim();
    if (trimmed.length < REQUIRED_TEXT_MIN_LENGTH) {
        reasons.push(`${label} must contain actionable detail`);
        return trimmed;
    }
    return trimmed;
}

function normalizeOptionalText(value: unknown, label: string, reasons: string[]): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        reasons.push(`${label} must be a string`);
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSourceRanges(
    value: unknown,
    reasons: string[],
    options: { label?: string; allowEmpty?: boolean } = {},
): DreamSourceRange[] {
    const label = options.label ?? 'sourceRanges';
    if (!Array.isArray(value) || value.length === 0) {
        if (Array.isArray(value) && value.length === 0 && options.allowEmpty) {
            return [];
        }
        reasons.push(`${label} must include at least one source reference`);
        return [];
    }

    const ranges: DreamSourceRange[] = [];
    for (const [index, raw] of value.entries()) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            reasons.push(`${label}[${index}] must be an object`);
            continue;
        }
        const entry = raw as Record<string, unknown>;
        const processId = typeof entry.processId === 'string' ? entry.processId.trim() : '';
        const startTurnIndex = entry.startTurnIndex;
        const endTurnIndex = entry.endTurnIndex;
        if (!processId) {
            reasons.push(`${label}[${index}].processId is required`);
        }
        if (!Number.isInteger(startTurnIndex) || (startTurnIndex as number) < 0) {
            reasons.push(`${label}[${index}].startTurnIndex must be a non-negative integer`);
        }
        if (!Number.isInteger(endTurnIndex) || (endTurnIndex as number) < 0) {
            reasons.push(`${label}[${index}].endTurnIndex must be a non-negative integer`);
        }
        if (
            Number.isInteger(startTurnIndex)
            && Number.isInteger(endTurnIndex)
            && (startTurnIndex as number) > (endTurnIndex as number)
        ) {
            reasons.push(`${label}[${index}].startTurnIndex must be <= endTurnIndex`);
        }
        if (
            processId
            && Number.isInteger(startTurnIndex)
            && Number.isInteger(endTurnIndex)
            && (startTurnIndex as number) >= 0
            && (endTurnIndex as number) >= 0
            && (startTurnIndex as number) <= (endTurnIndex as number)
        ) {
            ranges.push({
                processId,
                startTurnIndex: startTurnIndex as number,
                endTurnIndex: endTurnIndex as number,
            });
        }
    }
    return ranges;
}

function normalizeRunSourceRanges(value: unknown, label: string, allowEmpty: boolean): DreamSourceRange[] {
    const reasons: string[] = [];
    const ranges = normalizeSourceRanges(value, reasons, { label, allowEmpty });
    if (reasons.length > 0) {
        throw new Error(`Invalid dream run source ranges: ${reasons.join('; ')}`);
    }
    return ranges;
}

function normalizeFingerprintText(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

export function buildDreamDedupFingerprint(input: Pick<CreateDreamCandidateInput, 'category' | 'observedPattern' | 'recommendation'>): string {
    const normalizedSignal = [
        input.category,
        normalizeFingerprintText(input.observedPattern),
        normalizeFingerprintText(input.recommendation),
    ].join('\n');
    const hash = crypto.createHash('sha256').update(normalizedSignal).digest('hex').slice(0, 32);
    return `dream:${input.category}:${hash}`;
}

function normalizeProvidedFingerprint(value: unknown, reasons: string[]): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') {
        reasons.push('dedupFingerprint must be a string');
        return undefined;
    }
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
    if (!normalized) return undefined;
    if (normalized.length > FINGERPRINT_MAX_LENGTH) {
        reasons.push(`dedupFingerprint must be ${FINGERPRINT_MAX_LENGTH} characters or fewer`);
        return undefined;
    }
    return normalized;
}

export class DreamCandidatePrefilterError extends Error {
    readonly reasons: string[];

    constructor(reasons: string[]) {
        super(`Dream candidate rejected: ${reasons.join('; ')}`);
        this.name = 'DreamCandidatePrefilterError';
        this.reasons = reasons;
    }
}

export function prefilterDreamCandidate(input: CreateDreamCandidateInput): DreamCandidatePrefilterResult {
    const reasons: string[] = [];
    const raw = input as unknown as Record<string, unknown>;
    const workspaceId = typeof raw.workspaceId === 'string' ? raw.workspaceId.trim() : '';
    if (!workspaceId) {
        reasons.push('workspaceId is required');
    }

    const category = raw.category;
    if (!isDreamCategory(category)) {
        reasons.push(`category must be one of: ${DREAM_CARD_CATEGORIES.join(', ')}`);
    }

    const sourceRanges = normalizeSourceRanges(raw.sourceRanges, reasons);
    const observedPattern = normalizeRequiredText(raw.observedPattern, 'observedPattern', reasons);
    const whyItMatters = normalizeRequiredText(raw.whyItMatters, 'whyItMatters', reasons);
    const recommendation = normalizeRequiredText(raw.recommendation, 'recommendation', reasons);
    const expectedImpact = normalizeRequiredText(raw.expectedImpact, 'expectedImpact', reasons);
    const notAlreadyCoveredRationale = normalizeRequiredText(raw.notAlreadyCoveredRationale, 'notAlreadyCoveredRationale', reasons);
    const criticRationale = normalizeOptionalText(raw.criticRationale, 'criticRationale', reasons);
    const dedupRationale = normalizeOptionalText(raw.dedupRationale, 'dedupRationale', reasons);

    const confidence = raw.confidence;
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        reasons.push('confidence must be a number between 0 and 1');
    }

    const providedFingerprint = normalizeProvidedFingerprint(raw.dedupFingerprint, reasons);

    if (reasons.length > 0 || !isDreamCategory(category) || typeof confidence !== 'number') {
        return { accepted: false, reasons };
    }

    return {
        accepted: true,
        candidate: {
            workspaceId,
            ...(typeof raw.runId === 'string' && raw.runId.trim().length > 0 ? { runId: raw.runId.trim() } : {}),
            category,
            sourceRanges,
            observedPattern,
            whyItMatters,
            recommendation,
            expectedImpact,
            confidence,
            dedupFingerprint: providedFingerprint ?? buildDreamDedupFingerprint({
                category,
                observedPattern,
                recommendation,
            }),
            notAlreadyCoveredRationale,
            ...(criticRationale ? { criticRationale } : {}),
            ...(dedupRationale ? { dedupRationale } : {}),
        },
    };
}

function normalizeStatuses(statuses: DreamCardListOptions['statuses']): DreamCardStatus[] | undefined {
    if (!statuses) return undefined;
    const list = Array.isArray(statuses) ? statuses : [statuses];
    for (const status of list) {
        if (!isDreamStatus(status)) {
            throw new Error(`Invalid dream card status: ${String(status)}`);
        }
    }
    return [...new Set(list)];
}

function sortCards(cards: DreamCard[]): DreamCard[] {
    return [...cards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt));
}

function sortRuns(runs: DreamRunRecord[]): DreamRunRecord[] {
    return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function normalizeRunTrigger(value: unknown): CreateDreamRunInput['trigger'] {
    if (value === 'manual' || value === 'idle') return value;
    throw new Error('Dream run trigger must be manual or idle');
}

function normalizeRunProvider(value: unknown): ChatProvider | undefined {
    if (value === undefined) return undefined;
    if (value === 'copilot' || value === 'codex' || value === 'claude') return value;
    throw new Error('Dream run provider must be copilot, codex, or claude');
}

function normalizeRunReasoningEffort(value: unknown): ReasoningEffort | undefined {
    if (value === undefined) return undefined;
    if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
    throw new Error('Dream run reasoningEffort must be low, medium, high, or xhigh');
}

function normalizeOptionalRunText(value: unknown, fieldName: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string') {
        throw new Error(`Dream run ${fieldName} must be a string`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`Dream run ${fieldName} must be non-empty`);
    }
    return trimmed;
}

function normalizeRunTimeoutMs(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error('Dream run timeoutMs must be a positive number');
    }
    return Math.trunc(value);
}

function normalizeCandidateCardIds(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
        throw new Error('candidateCardIds must be an array');
    }
    const ids = value.map(raw => {
        if (typeof raw !== 'string' || !raw.trim()) {
            throw new Error('candidateCardIds entries must be non-empty strings');
        }
        return assertCardId(raw.trim());
    });
    return [...new Set(ids)];
}

function dedupeSourceRanges(ranges: readonly DreamSourceRange[]): DreamSourceRange[] {
    const seen = new Set<string>();
    const deduped: DreamSourceRange[] = [];
    for (const range of ranges) {
        const key = `${range.processId}:${range.startTurnIndex}:${range.endTurnIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(range);
    }
    return deduped.sort((a, b) =>
        a.processId.localeCompare(b.processId)
        || a.startTurnIndex - b.startTurnIndex
        || a.endTurnIndex - b.endTurnIndex
    );
}

export class FileDreamStore {
    private readonly dataDir: string;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(options: FileDreamStoreOptions) {
        this.dataDir = options.dataDir;
    }

    private dreamsDir(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, 'dreams');
    }

    private cardsPath(workspaceId: string): string {
        return path.join(this.dreamsDir(workspaceId), 'cards.json');
    }

    private runsPath(workspaceId: string): string {
        return path.join(this.dreamsDir(workspaceId), 'runs.json');
    }

    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async readCards(workspaceId: string): Promise<DreamCard[]> {
        try {
            const raw = await fs.readFile(this.cardsPath(workspaceId), 'utf-8');
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
                return parsed as DreamCard[];
            }
            if (
                typeof parsed === 'object'
                && parsed !== null
                && Array.isArray((parsed as StoredDreamCardsFile).cards)
            ) {
                return (parsed as StoredDreamCardsFile).cards;
            }
            throw new Error(`Invalid dream cards file for workspace '${workspaceId}'`);
        } catch (err: any) {
            if (err?.code === 'ENOENT') return [];
            throw err;
        }
    }

    private async writeCards(workspaceId: string, cards: DreamCard[]): Promise<void> {
        await atomicWriteJSON(this.cardsPath(workspaceId), { version: 1, cards } satisfies StoredDreamCardsFile);
    }

    private async readRuns(workspaceId: string): Promise<DreamRunRecord[]> {
        try {
            const raw = await fs.readFile(this.runsPath(workspaceId), 'utf-8');
            const parsed = JSON.parse(raw) as unknown;
            if (
                typeof parsed === 'object'
                && parsed !== null
                && Array.isArray((parsed as StoredDreamRunsFile).runs)
            ) {
                return (parsed as StoredDreamRunsFile).runs;
            }
            throw new Error(`Invalid dream runs file for workspace '${workspaceId}'`);
        } catch (err: any) {
            if (err?.code === 'ENOENT') return [];
            throw err;
        }
    }

    private async writeRuns(workspaceId: string, runs: DreamRunRecord[]): Promise<void> {
        await atomicWriteJSON(this.runsPath(workspaceId), { version: 1, runs } satisfies StoredDreamRunsFile);
    }

    async createRun(input: CreateDreamRunInput): Promise<DreamRunRecord> {
        const workspaceId = input.workspaceId.trim();
        if (!workspaceId) {
            throw new Error('workspaceId is required');
        }
        const trigger = normalizeRunTrigger(input.trigger);
        const provider = normalizeRunProvider(input.provider);
        const model = normalizeOptionalRunText(input.model, 'model');
        const reasoningEffort = normalizeRunReasoningEffort(input.reasoningEffort);
        const timeoutMs = normalizeRunTimeoutMs(input.timeoutMs);

        return this.enqueueWrite(async () => {
            const runs = await this.readRuns(workspaceId);
            let id = mintRunId();
            const existingIds = new Set(runs.map(run => run.id));
            while (existingIds.has(id)) {
                id = mintRunId();
            }
            const now = new Date().toISOString();
            const run: DreamRunRecord = {
                id,
                workspaceId,
                trigger,
                status: 'running',
                ...(provider ? { provider } : {}),
                ...(model ? { model } : {}),
                ...(reasoningEffort ? { reasoningEffort } : {}),
                ...(timeoutMs !== undefined ? { timeoutMs } : {}),
                sourceRanges: [],
                candidateCardIds: [],
                startedAt: now,
            };
            await this.writeRuns(workspaceId, [...runs, run]);
            return run;
        });
    }

    async listRuns(workspaceId: string): Promise<DreamRunRecord[]> {
        return sortRuns(await this.readRuns(workspaceId));
    }

    async getRun(workspaceId: string, runId: string): Promise<DreamRunRecord | undefined> {
        const safeRunId = assertCardId(runId);
        const runs = await this.readRuns(workspaceId);
        return runs.find(run => run.id === safeRunId);
    }

    async completeRun(workspaceId: string, runId: string, input: CompleteDreamRunInput): Promise<DreamRunRecord> {
        const sourceRanges = normalizeRunSourceRanges(input.sourceRanges, 'sourceRanges', true);
        const candidateCardIds = normalizeCandidateCardIds(input.candidateCardIds);
        return this.transitionRun(workspaceId, runId, 'completed', run => ({
            ...run,
            status: 'completed',
            sourceRanges: dedupeSourceRanges(sourceRanges),
            candidateCardIds,
            completedAt: new Date().toISOString(),
        }));
    }

    async failRun(workspaceId: string, runId: string, input: FailDreamRunInput): Promise<DreamRunRecord> {
        const error = input.error.trim();
        if (!error) {
            throw new Error('error is required');
        }
        const sourceRanges = input.sourceRanges
            ? normalizeRunSourceRanges(input.sourceRanges, 'sourceRanges', true)
            : [];
        const candidateCardIds = normalizeCandidateCardIds(input.candidateCardIds);
        return this.transitionRun(workspaceId, runId, 'failed', run => ({
            ...run,
            status: 'failed',
            sourceRanges: dedupeSourceRanges(sourceRanges),
            candidateCardIds,
            failedAt: new Date().toISOString(),
            error,
        }));
    }

    async listCoveredSourceRanges(workspaceId: string): Promise<DreamSourceRange[]> {
        const [runs, cards] = await Promise.all([
            this.readRuns(workspaceId),
            this.readCards(workspaceId),
        ]);
        const completedRunRanges = runs
            .filter(run => run.status === 'completed')
            .flatMap(run => run.sourceRanges);
        const cardRanges = cards.flatMap(card => card.sourceRanges);
        return dedupeSourceRanges([...completedRunRanges, ...cardRanges]);
    }

    async createCandidate(input: CreateDreamCandidateInput): Promise<DreamCard> {
        const result = prefilterDreamCandidate(input);
        if (!result.accepted) {
            throw new DreamCandidatePrefilterError(result.reasons);
        }

        return this.enqueueWrite(async () => {
            const cards = await this.readCards(result.candidate.workspaceId);
            let id = mintCardId();
            const existingIds = new Set(cards.map(card => card.id));
            while (existingIds.has(id)) {
                id = mintCardId();
            }
            const now = new Date().toISOString();
            const card: DreamCard = {
                id,
                workspaceId: result.candidate.workspaceId,
                ...(result.candidate.runId ? { runId: result.candidate.runId } : {}),
                category: result.candidate.category,
                status: 'candidate',
                sourceRanges: result.candidate.sourceRanges,
                observedPattern: result.candidate.observedPattern,
                whyItMatters: result.candidate.whyItMatters,
                recommendation: result.candidate.recommendation,
                expectedImpact: result.candidate.expectedImpact,
                confidence: result.candidate.confidence,
                dedupFingerprint: result.candidate.dedupFingerprint,
                notAlreadyCoveredRationale: result.candidate.notAlreadyCoveredRationale,
                ...(result.candidate.criticRationale ? { criticRationale: result.candidate.criticRationale } : {}),
                ...(result.candidate.dedupRationale ? { dedupRationale: result.candidate.dedupRationale } : {}),
                createdAt: now,
                updatedAt: now,
            };
            await this.writeCards(card.workspaceId, [...cards, card]);
            return card;
        });
    }

    async listCards(workspaceId: string, options: DreamCardListOptions = {}): Promise<DreamCard[]> {
        const statuses = normalizeStatuses(options.statuses);
        const cards = await this.readCards(workspaceId);
        const visibleStatuses = new Set<DreamCardStatus>(
            statuses ?? (options.includeHidden ? DREAM_CARD_STATUSES : [...DREAM_REVIEW_VISIBLE_STATUSES]),
        );
        return sortCards(cards.filter(card => visibleStatuses.has(card.status)));
    }

    async getCard(workspaceId: string, cardId: string): Promise<DreamCard | undefined> {
        const safeCardId = assertCardId(cardId);
        const cards = await this.readCards(workspaceId);
        return cards.find(card => card.id === safeCardId);
    }

    async findCardsByFingerprint(workspaceId: string, dedupFingerprint: string): Promise<DreamCard[]> {
        const normalized = normalizeProvidedFingerprint(dedupFingerprint, []);
        if (!normalized) return [];
        const cards = await this.readCards(workspaceId);
        return sortCards(cards.filter(card => card.dedupFingerprint === normalized));
    }

    async promoteCandidate(workspaceId: string, cardId: string, options: DreamPromotionOptions = {}): Promise<DreamCard> {
        return this.enqueueWrite(async () => {
            const cards = await this.readCards(workspaceId);
            const index = cards.findIndex(card => card.id === assertCardId(cardId));
            if (index < 0) {
                throw new Error(`Dream card not found: ${cardId}`);
            }
            const current = cards[index];
            if (current.status !== 'candidate') {
                throw new Error(`Dream card '${cardId}' is ${current.status}; only candidate cards can become visible`);
            }

            const now = new Date().toISOString();
            const duplicate = cards.find(card =>
                card.id !== current.id
                && card.dedupFingerprint === current.dedupFingerprint
                && card.status !== 'candidate'
            );
            const next: DreamCard = duplicate
                ? {
                    ...current,
                    status: 'superseded',
                    supersededAt: now,
                    supersededByCardId: duplicate.id,
                    dedupRationale: options.dedupRationale ?? `Duplicate of prior dream card ${duplicate.id}`,
                    ...(options.criticRationale ? { criticRationale: options.criticRationale } : {}),
                    updatedAt: now,
                }
                : {
                    ...current,
                    status: 'visible',
                    visibleAt: now,
                    ...(options.criticRationale ? { criticRationale: options.criticRationale } : {}),
                    ...(options.dedupRationale ? { dedupRationale: options.dedupRationale } : {}),
                    updatedAt: now,
                };
            cards[index] = next;
            await this.writeCards(workspaceId, cards);
            return next;
        });
    }

    async approveCard(workspaceId: string, cardId: string): Promise<DreamCard> {
        return this.transitionVisibleCard(workspaceId, cardId, 'approved', (card, now) => ({
            ...card,
            status: 'approved',
            approvedAt: now,
            updatedAt: now,
        }));
    }

    async dismissCard(workspaceId: string, cardId: string, options: DreamDismissOptions = {}): Promise<DreamCard> {
        return this.transitionVisibleCard(workspaceId, cardId, 'dismissed', (card, now) => ({
            ...card,
            status: 'dismissed',
            dismissedAt: now,
            ...(options.dedupRationale ? { dedupRationale: options.dedupRationale } : {}),
            updatedAt: now,
        }));
    }

    async convertCard(workspaceId: string, cardId: string, conversion: Omit<DreamConversionLink, 'createdAt'>): Promise<DreamCard> {
        if (!conversion.artifactId.trim()) {
            throw new Error('conversion.artifactId is required');
        }
        return this.enqueueWrite(async () => {
            const cards = await this.readCards(workspaceId);
            const index = cards.findIndex(card => card.id === assertCardId(cardId));
            if (index < 0) {
                throw new Error(`Dream card not found: ${cardId}`);
            }
            const current = cards[index];
            if (current.status !== 'visible' && current.status !== 'approved') {
                throw new Error(`Dream card '${cardId}' is ${current.status}; only visible or approved cards can be converted`);
            }
            const now = new Date().toISOString();
            const next: DreamCard = {
                ...current,
                status: 'converted',
                conversion: {
                    ...conversion,
                    artifactId: conversion.artifactId.trim(),
                    artifactUrl: conversion.artifactUrl?.trim() || undefined,
                    createdAt: now,
                },
                convertedAt: now,
                updatedAt: now,
            };
            cards[index] = next;
            await this.writeCards(workspaceId, cards);
            return next;
        });
    }

    async markSuperseded(workspaceId: string, cardId: string, options: DreamSupersedeOptions): Promise<DreamCard> {
        if (options.supersededByCardId && options.supersededByCardId === cardId) {
            throw new Error('A dream card cannot supersede itself');
        }
        const rationale = options.dedupRationale.trim();
        if (!rationale) {
            throw new Error('dedupRationale is required');
        }

        return this.enqueueWrite(async () => {
            const cards = await this.readCards(workspaceId);
            const index = cards.findIndex(card => card.id === assertCardId(cardId));
            if (index < 0) {
                throw new Error(`Dream card not found: ${cardId}`);
            }
            const current = cards[index];
            if (current.status !== 'candidate' && current.status !== 'visible') {
                throw new Error(`Dream card '${cardId}' is ${current.status}; only candidate or visible cards can be superseded`);
            }
            const now = new Date().toISOString();
            const next: DreamCard = {
                ...current,
                status: 'superseded',
                supersededAt: now,
                ...(options.supersededByCardId ? { supersededByCardId: options.supersededByCardId } : {}),
                dedupRationale: rationale,
                updatedAt: now,
            };
            cards[index] = next;
            await this.writeCards(workspaceId, cards);
            return next;
        });
    }

    private async transitionVisibleCard(
        workspaceId: string,
        cardId: string,
        nextStatus: DreamCardStatus,
        buildNext: (card: DreamCard, now: string) => DreamCard,
    ): Promise<DreamCard> {
        return this.enqueueWrite(async () => {
            const cards = await this.readCards(workspaceId);
            const index = cards.findIndex(card => card.id === assertCardId(cardId));
            if (index < 0) {
                throw new Error(`Dream card not found: ${cardId}`);
            }
            const current = cards[index];
            if (current.status !== 'visible') {
                throw new Error(`Dream card '${cardId}' is ${current.status}; only visible cards can be marked ${nextStatus}`);
            }
            const next = buildNext(current, new Date().toISOString());
            cards[index] = next;
            await this.writeCards(workspaceId, cards);
            return next;
        });
    }

    private async transitionRun(
        workspaceId: string,
        runId: string,
        nextStatus: DreamRunStatus,
        buildNext: (run: DreamRunRecord) => DreamRunRecord,
    ): Promise<DreamRunRecord> {
        if (!isDreamRunStatus(nextStatus)) {
            throw new Error(`Invalid dream run status: ${String(nextStatus)}`);
        }
        return this.enqueueWrite(async () => {
            const runs = await this.readRuns(workspaceId);
            const index = runs.findIndex(run => run.id === assertCardId(runId));
            if (index < 0) {
                throw new Error(`Dream run not found: ${runId}`);
            }
            const current = runs[index];
            if (current.status !== 'running') {
                throw new Error(`Dream run '${runId}' is ${current.status}; only running dream runs can become ${nextStatus}`);
            }
            const next = buildNext(current);
            runs[index] = next;
            await this.writeRuns(workspaceId, runs);
            return next;
        });
    }
}
