/**
 * Single place where an untrusted REST body becomes a typed schedule shape.
 * The POST (create) and PATCH (update) routes share the same field
 * vocabulary — `targetType`, `mode`, `provider`, `status`, `onFailure`,
 * `outputFolder`, `model` — so they share the same validators and coercions
 * here instead of each hand-copying `any` fields.
 *
 * Error messages are the API contract and must stay stable.
 */

import type { ScheduleEntry, ScheduleOnFailure, ScheduleStatus } from './schedule-manager-types';
import { parseCron } from './cron-utils';
import type { ChatMode, ChatProvider, TargetType } from '../tasks/task-types';
import { normalizeChatMode, VALID_CHAT_PROVIDERS } from '../tasks/task-types';

const VALID_STATUSES: Set<string> = new Set(['active', 'paused', 'stopped']);
const VALID_ON_FAILURE: Set<string> = new Set(['notify', 'stop']);
const VALID_TARGET_TYPES: Set<string> = new Set(['prompt', 'script']);

/** The fields a create request produces, ready for `ScheduleManager.addSchedule`. */
export type ScheduleCreateInput = Omit<ScheduleEntry, 'id' | 'createdAt'>;

/** The fields a patch request produces, ready for `ScheduleManager.updateSchedule`. */
export type ScheduleUpdateInput = Partial<
    Pick<
        ScheduleEntry,
        'name' | 'target' | 'cron' | 'params' | 'onFailure' | 'status'
        | 'targetType' | 'outputFolder' | 'model' | 'mode' | 'provider'
    >
>;

/** Either a parsed value or the 400 message to return. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Coerce a raw mode to a mode a REST caller may set.
 *
 * `ralph` is deliberately excluded: it is reachable only through repo YAML,
 * not the schedule REST API.
 */
export function normalizeScheduleMode(mode: unknown): ChatMode | undefined {
    const normalized = normalizeChatMode(mode);
    if (normalized === 'ask' || normalized === 'autopilot') return normalized;
    return undefined;
}

/** Coerce a raw provider value to a supported ChatProvider, else undefined. */
export function normalizeScheduleProvider(provider: unknown): ChatProvider | undefined {
    if (typeof provider === 'string' && VALID_CHAT_PROVIDERS.has(provider as ChatProvider)) {
        return provider as ChatProvider;
    }
    return undefined;
}

/** Trim a raw value to a non-empty string, else undefined. */
function optionalTrimmed(value: unknown): string | undefined {
    if (!value) return undefined;
    const trimmed = String(value).trim();
    return trimmed || undefined;
}

/** Validate the enum-ish fields shared by create and update. */
function validateSharedFields(body: Record<string, unknown>): string | undefined {
    if (body.onFailure && !VALID_ON_FAILURE.has(body.onFailure as string)) {
        return `Invalid onFailure: ${body.onFailure}`;
    }
    if (body.status && !VALID_STATUSES.has(body.status as string)) {
        return `Invalid status: ${body.status}`;
    }
    if (body.targetType !== undefined && !VALID_TARGET_TYPES.has(body.targetType as string)) {
        return `Invalid targetType: ${body.targetType}. Valid values: prompt, script`;
    }
    if (body.mode !== undefined && !normalizeScheduleMode(body.mode)) {
        return `Invalid mode: ${body.mode}. Valid values: ask, autopilot`;
    }
    return undefined;
}

/**
 * Validate a create body. Kept separate from `parseScheduleCreateBody` so the
 * existing `{ valid, error }` contract stays available to callers/tests.
 */
export function validateScheduleInput(body: any): { valid: boolean; error?: string } {
    if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
        return { valid: false, error: 'Missing required field: name' };
    }
    if (!body.target || typeof body.target !== 'string' || !body.target.trim()) {
        return { valid: false, error: 'Missing required field: target' };
    }
    if (!body.cron || typeof body.cron !== 'string' || !body.cron.trim()) {
        return { valid: false, error: 'Missing required field: cron' };
    }
    try {
        parseCron(body.cron);
    } catch {
        return { valid: false, error: `Invalid cron expression: ${body.cron}` };
    }
    if (body.onFailure && !VALID_ON_FAILURE.has(body.onFailure)) {
        return { valid: false, error: `Invalid onFailure: ${body.onFailure}. Valid values: notify, stop` };
    }
    if (body.status && !VALID_STATUSES.has(body.status)) {
        return { valid: false, error: `Invalid status: ${body.status}. Valid values: active, paused, stopped` };
    }
    if (body.targetType !== undefined && !VALID_TARGET_TYPES.has(body.targetType)) {
        return { valid: false, error: `Invalid targetType: ${body.targetType}. Valid values: prompt, script` };
    }
    if (body.mode !== undefined && !normalizeScheduleMode(body.mode)) {
        return { valid: false, error: `Invalid mode: ${body.mode}. Valid values: ask, autopilot` };
    }
    if (body.provider !== undefined && !normalizeScheduleProvider(body.provider)) {
        return { valid: false, error: `Invalid provider: ${body.provider}. Valid values: copilot, codex, claude, opencode` };
    }
    return { valid: true };
}

/** Validate and normalize a POST body into schedule create input. */
export function parseScheduleCreateBody(body: any): ParseResult<ScheduleCreateInput> {
    const validation = validateScheduleInput(body);
    if (!validation.valid) return { ok: false, error: validation.error! };

    return {
        ok: true,
        value: {
            name: String(body.name).trim(),
            target: String(body.target).trim(),
            cron: String(body.cron).trim(),
            params: body.params || {},
            onFailure: (body.onFailure as ScheduleOnFailure) || 'notify',
            status: (body.status as ScheduleStatus) || 'active',
            targetType: (body.targetType as TargetType) || 'prompt',
            outputFolder: optionalTrimmed(body.outputFolder),
            model: optionalTrimmed(body.model),
            mode: normalizeScheduleMode(body.mode) || 'autopilot',
            provider: normalizeScheduleProvider(body.provider),
        },
    };
}

/**
 * Validate and normalize a PATCH body into a sparse update.
 *
 * Only keys actually present in the body appear in the result, so an omitted
 * field never clears an existing value.
 */
export function parseScheduleUpdateBody(body: any): ParseResult<ScheduleUpdateInput> {
    if (body.cron) {
        try {
            parseCron(body.cron);
        } catch {
            return { ok: false, error: `Invalid cron expression: ${body.cron}` };
        }
    }
    const sharedError = validateSharedFields(body);
    if (sharedError) return { ok: false, error: sharedError };

    // A blank/null provider is how the UI clears a pinned provider, so it is
    // accepted here even though an unknown non-empty provider is rejected.
    const clearsProvider = body.provider === null || body.provider === '';
    if (body.provider !== undefined && !clearsProvider && !normalizeScheduleProvider(body.provider)) {
        return { ok: false, error: `Invalid provider: ${body.provider}. Valid values: copilot, codex, claude, opencode` };
    }

    const updates: ScheduleUpdateInput = {};
    if (body.name) updates.name = String(body.name).trim();
    if (body.target) updates.target = String(body.target).trim();
    if (body.cron) updates.cron = String(body.cron).trim();
    if (body.params !== undefined) updates.params = body.params;
    if (body.onFailure) updates.onFailure = body.onFailure as ScheduleOnFailure;
    if (body.status) updates.status = body.status as ScheduleStatus;
    if (body.targetType !== undefined) updates.targetType = body.targetType as TargetType;
    if (body.outputFolder !== undefined) updates.outputFolder = optionalTrimmed(body.outputFolder);
    if (body.model !== undefined) updates.model = optionalTrimmed(body.model);
    if (body.mode !== undefined) updates.mode = normalizeScheduleMode(body.mode);
    if (body.provider !== undefined) updates.provider = normalizeScheduleProvider(body.provider);

    return { ok: true, value: updates };
}
