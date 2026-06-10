import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { atomicWriteJSON } from '../shared/fs-utils';
import type {
    CreateDreamCandidateInput,
    DreamCard,
    DreamCardCategory,
    DreamCardListOptions,
    DreamCardStatus,
    DreamConversionLink,
    DreamDismissOptions,
    DreamPromotionOptions,
    DreamSourceRange,
    DreamSupersedeOptions,
} from './types';
import {
    DREAM_CARD_CATEGORIES,
    DREAM_CARD_STATUSES,
    DREAM_REVIEW_VISIBLE_STATUSES,
} from './types';

interface StoredDreamCardsFile {
    version: 1;
    cards: DreamCard[];
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

function normalizeSourceRanges(value: unknown, reasons: string[]): DreamSourceRange[] {
    if (!Array.isArray(value) || value.length === 0) {
        reasons.push('sourceRanges must include at least one source reference');
        return [];
    }

    const ranges: DreamSourceRange[] = [];
    for (const [index, raw] of value.entries()) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            reasons.push(`sourceRanges[${index}] must be an object`);
            continue;
        }
        const entry = raw as Record<string, unknown>;
        const processId = typeof entry.processId === 'string' ? entry.processId.trim() : '';
        const startTurnIndex = entry.startTurnIndex;
        const endTurnIndex = entry.endTurnIndex;
        if (!processId) {
            reasons.push(`sourceRanges[${index}].processId is required`);
        }
        if (!Number.isInteger(startTurnIndex) || (startTurnIndex as number) < 0) {
            reasons.push(`sourceRanges[${index}].startTurnIndex must be a non-negative integer`);
        }
        if (!Number.isInteger(endTurnIndex) || (endTurnIndex as number) < 0) {
            reasons.push(`sourceRanges[${index}].endTurnIndex must be a non-negative integer`);
        }
        if (
            Number.isInteger(startTurnIndex)
            && Number.isInteger(endTurnIndex)
            && (startTurnIndex as number) > (endTurnIndex as number)
        ) {
            reasons.push(`sourceRanges[${index}].startTurnIndex must be <= endTurnIndex`);
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
}
