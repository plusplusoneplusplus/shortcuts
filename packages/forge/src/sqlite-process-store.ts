/**
 * SQLite-backed ProcessStore Implementation
 *
 * Single-file process store using better-sqlite3.
 * All methods are synchronous at the SQLite level, wrapped in async
 * to satisfy the ProcessStore interface's Promise return types.
 *
 * No VS Code dependencies — designed for the standalone CoC server.
 */

import * as fs from 'fs';
import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';

import {
    ProcessStore,
    ProcessFilter,
    ProcessIndexEntry,
    WorkspaceInfo,
    WikiInfo,
    ProcessChangeCallback,
    ProcessOutputEvent,
    StorageStats,
    SearchFilter,
    ConversationSearchResult,
    PromptAutocompleteContext,
    PromptAutocompleteHistoryItem,
} from './process-store';
import {
    AIProcess,
    AIProcessStatus,
    ConversationTurn,
    TimelineItem,
    ToolCall,
    ToolCallPermissionRequest,
    ToolCallPermissionResult,
    ProcessEvent,
} from './ai/process-types';
import type { AIBackendType } from './ai/types';
import type { TokenUsage } from '@plusplusoneplusplus/coc-agent-sdk';
import { initializeDatabase } from './sqlite-schema';
import { getLogger } from './logger';
import { computeMessagePreview } from './utils/message-preview';

const logger = getLogger();

/**
 * SQLite columns outside `processes`/`workspaces` that may hold a physical
 * workspace id. Some tables are created by CoC feature stores after forge
 * initializes the base schema, so each update is guarded by column existence.
 */
const WORKSPACE_ID_REFERENCE_COLUMNS = [
    { table: 'commit_chat_bindings', column: 'workspace_id' },
    { table: 'note_chat_bindings', column: 'workspace_id' },
    { table: 'pull_request_chat_bindings', column: 'workspace_id' },
    { table: 'work_item_chat_bindings', column: 'workspace_id' },
    { table: 'task_groups', column: 'workspace_id' },
    { table: 'task_group_members', column: 'workspace_id' },
    { table: 'loops', column: 'workspace_id' },
    { table: 'container_sessions', column: 'routing_override_workspace_id' },
    { table: 'container_session_turns', column: 'routing_workspace_id' },
    { table: 'queue_tasks', column: 'repo_id' },
    { table: 'queue_repo_state', column: 'repo_id' },
    { table: 'queue_repo_paths', column: 'repo_id' },
    { table: 'schedule_runs', column: 'repo_id' },
] as const;

// ============================================================================
// Options
// ============================================================================

export interface SqliteProcessStoreOptions {
    /** Absolute path to the .db file (e.g. ~/.coc/coc.db) */
    dbPath: string;
}

// ============================================================================
// Row types (snake_case, matching SQLite columns)
// ============================================================================

interface ProcessRow {
    id: string;
    workspace_id: string;
    type: string | null;
    prompt_preview: string | null;
    full_prompt: string | null;
    status: string;
    start_time: string;
    end_time: string | null;
    error: string | null;
    result: string | null;
    result_file_path: string | null;
    raw_stdout_file_path: string | null;
    metadata: string | null;
    group_metadata: string | null;
    structured_result: string | null;
    parent_process_id: string | null;
    sdk_session_id: string | null;
    backend: string | null;
    working_directory: string | null;
    title: string | null;
    custom_title: string | null;
    last_message_preview: string | null;
    token_limit: number | null;
    current_tokens: number | null;
    system_tokens: number | null;
    tool_definitions_tokens: number | null;
    conversation_tokens: number | null;
    cumulative_token_usage: string | null;
    stale: number;
    data_file_path: string | null;
    archived: number;
    pinned_at: string | null;
    seen_at: string | null;
    last_event_at: string | null;
}

interface TurnRow {
    id: number;
    process_id: string;
    turn_index: number;
    role: string;
    content: string | null;
    timestamp: string;
    streaming: number;
    interrupted: number;
    interruption_reason: string | null;
    tool_calls: string | null;
    timeline: string | null;
    images: string | null;
    historical: number;
    suggestions: string | null;
    token_usage: string | null;
    paste_externalized: number;
    model: string | null;
    mode: string | null;
    deleted_at: string | null;
    pinned_at: string | null;
    archived: number;
    sdk_event_id: string | null;
}

interface PromptAutocompleteHistoryRow {
    text: string;
    source: 'initial' | 'follow-up';
    workspaceId: string;
    processId: string;
    timestamp: string;
}

interface WorkspaceRow {
    id: string;
    name: string;
    root_path: string;
    color: string | null;
    remote_url: string | null;
    description: string | null;
    enabled_mcp_servers: string | null;
    disabled_skills: string | null;
    extra_skill_folders: string | null;
    virtual: number;
}

interface WikiRow {
    id: string;
    name: string;
    wiki_dir: string;
    repo_path: string | null;
    color: string | null;
    ai_enabled: number;
    registered_at: string;
}

interface CountRow {
    cnt: number;
}

interface MaxTurnIndexRow {
    next_idx: number;
}

interface StreamingTurnRow {
    turn_index: number;
}

// ============================================================================
// Metadata envelope stored in the `metadata` TEXT column.
// Folds legacy metadata fields + pendingMessages alongside GenericProcessMetadata.
// ============================================================================

interface MetadataEnvelope {
    [key: string]: unknown;
    __codeReviewMetadata?: unknown;
    __discoveryMetadata?: unknown;
    __codeReviewGroupMetadata?: unknown;
    __pendingMessages?: unknown;
    __pendingAskUser?: unknown;
    __pendingAskUserAnswer?: unknown;
}

// ============================================================================
// Helpers
// ============================================================================

function jsonStringify(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
}

function jsonParse<T>(value: string | null): T | undefined {
    if (value === null || value === undefined) return undefined;
    try {
        return JSON.parse(value) as T;
    } catch {
        return undefined;
    }
}

function boolToInt(value: boolean | undefined): number {
    return value ? 1 : 0;
}

function intToBool(value: number): boolean | undefined {
    return value ? true : undefined;
}

function dateToIso(date: Date | undefined): string | null {
    if (!date) return null;
    return date.toISOString();
}

function isoToDate(iso: string | null): Date | undefined {
    if (!iso) return undefined;
    return new Date(iso);
}

/** Parse an ISO date string, returning a fallback for invalid/missing values. */
function safeDate(value: unknown, fallback?: Date): Date {
    if (!value) return fallback ?? new Date(0);
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? (fallback ?? new Date(0)) : d;
}

/** Parse an optional ISO date string, returning undefined for missing values. */
function safeDateOptional(value: unknown): Date | undefined {
    if (!value) return undefined;
    const d = new Date(value as string);
    return isNaN(d.getTime()) ? undefined : d;
}

/** Serialize a ToolCall's Date fields to ISO strings for JSON storage. */
function serializeToolCall(tc: ToolCall): Record<string, unknown> {
    return {
        id: tc.id,
        name: tc.name,
        status: tc.status,
        startTime: tc.startTime.toISOString(),
        endTime: tc.endTime?.toISOString(),
        args: tc.args,
        result: tc.result,
        error: tc.error,
        parentToolCallId: tc.parentToolCallId,
        permissionRequest: tc.permissionRequest ? {
            kind: tc.permissionRequest.kind,
            timestamp: tc.permissionRequest.timestamp.toISOString(),
            resource: tc.permissionRequest.resource,
            operation: tc.permissionRequest.operation,
        } : undefined,
        permissionResult: tc.permissionResult ? {
            approved: tc.permissionResult.approved,
            timestamp: tc.permissionResult.timestamp.toISOString(),
            reason: tc.permissionResult.reason,
        } : undefined,
    };
}

/** Deserialize a ToolCall from JSON with ISO string dates. */
function deserializeToolCall(raw: Record<string, unknown>): ToolCall {
    return {
        id: (raw.id ?? '') as string,
        name: (raw.name ?? '') as string,
        status: (raw.status ?? 'completed') as ToolCall['status'],
        startTime: safeDate(raw.startTime),
        endTime: safeDateOptional(raw.endTime),
        args: (raw.args ?? {}) as Record<string, unknown>,
        result: raw.result as string | undefined,
        error: raw.error as string | undefined,
        parentToolCallId: raw.parentToolCallId as string | undefined,
        permissionRequest: raw.permissionRequest ? {
            kind: (raw.permissionRequest as Record<string, unknown>).kind as string,
            timestamp: safeDate((raw.permissionRequest as Record<string, unknown>).timestamp),
            resource: (raw.permissionRequest as Record<string, unknown>).resource as string | undefined,
            operation: (raw.permissionRequest as Record<string, unknown>).operation as string | undefined,
        } as ToolCallPermissionRequest : undefined,
        permissionResult: raw.permissionResult ? {
            approved: (raw.permissionResult as Record<string, unknown>).approved as boolean,
            timestamp: safeDate((raw.permissionResult as Record<string, unknown>).timestamp),
            reason: (raw.permissionResult as Record<string, unknown>).reason as string | undefined,
        } as ToolCallPermissionResult : undefined,
    };
}

/** Serialize a TimelineItem's Date fields to ISO strings for JSON storage. */
function serializeTimelineItem(item: TimelineItem): Record<string, unknown> {
    return {
        type: item.type,
        timestamp: item.timestamp.toISOString(),
        content: item.content,
        toolCall: item.toolCall ? serializeToolCall(item.toolCall) : undefined,
    };
}

/** Deserialize a TimelineItem from JSON with ISO string dates. */
function deserializeTimelineItem(raw: Record<string, unknown>): TimelineItem {
    return {
        type: raw.type as TimelineItem['type'],
        timestamp: safeDate(raw.timestamp),
        content: raw.content as string | undefined,
        toolCall: raw.toolCall ? deserializeToolCall(raw.toolCall as Record<string, unknown>) : undefined,
    };
}

// ============================================================================
// Process ↔ Row conversion
// ============================================================================

function processToRow(process: AIProcess): Record<string, unknown> {
    // Fold legacy metadata + process-runtime state into the metadata JSON blob
    const envelope: MetadataEnvelope = { ...(process.metadata ?? {}) };
    if (process.codeReviewMetadata) envelope.__codeReviewMetadata = process.codeReviewMetadata;
    if (process.discoveryMetadata) envelope.__discoveryMetadata = process.discoveryMetadata;
    if (process.codeReviewGroupMetadata) envelope.__codeReviewGroupMetadata = process.codeReviewGroupMetadata;
    if (process.pendingMessages && process.pendingMessages.length > 0) envelope.__pendingMessages = process.pendingMessages;
    if (process.pendingAskUser) envelope.__pendingAskUser = process.pendingAskUser;
    if (process.pendingAskUserAnswer) envelope.__pendingAskUserAnswer = process.pendingAskUserAnswer;

    const hasMetadataContent = process.metadata || process.codeReviewMetadata ||
        process.discoveryMetadata || process.codeReviewGroupMetadata ||
        (process.pendingMessages && process.pendingMessages.length > 0) ||
        process.pendingAskUser || process.pendingAskUserAnswer;

    return {
        id: process.id,
        workspace_id: process.metadata?.workspaceId ?? '',
        type: process.type ?? null,
        prompt_preview: process.promptPreview ?? null,
        full_prompt: process.fullPrompt ?? null,
        status: process.status,
        start_time: process.startTime.toISOString(),
        end_time: dateToIso(process.endTime),
        error: process.error ?? null,
        result: process.result ?? null,
        result_file_path: process.resultFilePath ?? null,
        raw_stdout_file_path: process.rawStdoutFilePath ?? null,
        metadata: hasMetadataContent ? JSON.stringify(envelope) : null,
        group_metadata: jsonStringify(process.groupMetadata),
        structured_result: process.structuredResult ?? null,
        parent_process_id: process.parentProcessId ?? null,
        sdk_session_id: process.sdkSessionId ?? null,
        backend: process.backend ?? null,
        working_directory: process.workingDirectory ?? null,
        title: process.title ?? null,
        custom_title: process.customTitle ?? null,
        last_message_preview: process.lastMessagePreview ?? null,
        token_limit: process.tokenLimit ?? null,
        current_tokens: process.currentTokens ?? null,
        system_tokens: process.systemTokens ?? null,
        tool_definitions_tokens: process.toolDefinitionsTokens ?? null,
        conversation_tokens: process.conversationTokens ?? null,
        cumulative_token_usage: jsonStringify(process.cumulativeTokenUsage),
        stale: boolToInt(process.stale),
        data_file_path: process.dataFilePath ?? null,
        archived: boolToInt(process.archived),
        pinned_at: process.pinnedAt ?? null,
        last_event_at: dateToIso(process.lastEventAt ?? process.startTime),
    };
}

function rowToProcess(row: ProcessRow, turns?: ConversationTurn[]): AIProcess {
    // Parse the metadata envelope and extract legacy/folded fields
    const envelope = jsonParse<MetadataEnvelope>(row.metadata);
    let metadata: AIProcess['metadata'] | undefined;
    let codeReviewMetadata: AIProcess['codeReviewMetadata'] | undefined;
    let discoveryMetadata: AIProcess['discoveryMetadata'] | undefined;
    let codeReviewGroupMetadata: AIProcess['codeReviewGroupMetadata'] | undefined;
    let pendingMessages: AIProcess['pendingMessages'] | undefined;
    let pendingAskUser: AIProcess['pendingAskUser'] | undefined;
    let pendingAskUserAnswer: AIProcess['pendingAskUserAnswer'] | undefined;

    if (envelope) {
        const { __codeReviewMetadata, __discoveryMetadata, __codeReviewGroupMetadata, __pendingMessages, __pendingAskUser, __pendingAskUserAnswer, ...rest } = envelope;
        metadata = Object.keys(rest).length > 0 ? rest as AIProcess['metadata'] : undefined;
        codeReviewMetadata = __codeReviewMetadata as AIProcess['codeReviewMetadata'];
        discoveryMetadata = __discoveryMetadata as AIProcess['discoveryMetadata'];
        codeReviewGroupMetadata = __codeReviewGroupMetadata as AIProcess['codeReviewGroupMetadata'];
        pendingMessages = __pendingMessages as AIProcess['pendingMessages'];
        pendingAskUser = __pendingAskUser as AIProcess['pendingAskUser'];
        pendingAskUserAnswer = __pendingAskUserAnswer as AIProcess['pendingAskUserAnswer'];
    }

    const process: AIProcess = {
        id: row.id,
        type: (row.type ?? 'clarification') as AIProcess['type'],
        promptPreview: row.prompt_preview ?? '',
        fullPrompt: row.full_prompt ?? '',
        status: row.status as AIProcessStatus,
        startTime: new Date(row.start_time),
        endTime: isoToDate(row.end_time),
        error: row.error ?? undefined,
        result: row.result ?? undefined,
        resultFilePath: row.result_file_path ?? undefined,
        rawStdoutFilePath: row.raw_stdout_file_path ?? undefined,
        metadata,
        groupMetadata: jsonParse(row.group_metadata),
        codeReviewMetadata,
        discoveryMetadata,
        codeReviewGroupMetadata,
        structuredResult: row.structured_result ?? undefined,
        parentProcessId: row.parent_process_id ?? undefined,
        sdkSessionId: row.sdk_session_id ?? undefined,
        backend: (row.backend ?? undefined) as AIBackendType | undefined,
        workingDirectory: row.working_directory ?? undefined,
        title: row.title ?? undefined,
        customTitle: row.custom_title ?? undefined,
        lastMessagePreview: row.last_message_preview ?? undefined,
        tokenLimit: row.token_limit ?? undefined,
        currentTokens: row.current_tokens ?? undefined,
        systemTokens: row.system_tokens ?? undefined,
        toolDefinitionsTokens: row.tool_definitions_tokens ?? undefined,
        conversationTokens: row.conversation_tokens ?? undefined,
        cumulativeTokenUsage: jsonParse<TokenUsage>(row.cumulative_token_usage),
        stale: intToBool(row.stale),
        dataFilePath: row.data_file_path ?? undefined,
        pendingMessages,
        pendingAskUser,
        pendingAskUserAnswer,
        lastEventAt: isoToDate(row.last_event_at),
        pinnedAt: row.pinned_at ?? undefined,
        archived: intToBool(row.archived),
    };

    if (turns) {
        process.conversationTurns = turns;
    }

    return process;
}

// ============================================================================
// Turn ↔ Row conversion
// ============================================================================

function turnToRow(turn: ConversationTurn, processId: string): Record<string, unknown> {
    return {
        process_id: processId,
        turn_index: turn.turnIndex,
        role: turn.role,
        content: turn.content ?? null,
        timestamp: turn.timestamp.toISOString(),
        streaming: boolToInt(turn.streaming),
        interrupted: boolToInt(turn.interrupted),
        interruption_reason: turn.interruptionReason ?? null,
        tool_calls: turn.toolCalls ? JSON.stringify(turn.toolCalls.map(serializeToolCall)) : null,
        timeline: JSON.stringify((turn.timeline ?? []).map(serializeTimelineItem)),
        images: turn.images ? JSON.stringify(turn.images) : null,
        historical: boolToInt(turn.historical),
        suggestions: turn.suggestions ? JSON.stringify(turn.suggestions) : null,
        token_usage: jsonStringify(turn.tokenUsage),
        paste_externalized: boolToInt(turn.pasteExternalized),
        model: turn.model ?? null,
        mode: turn.mode ?? null,
        sdk_event_id: turn.sdkEventId ?? null,
        deleted_at: dateToIso(turn.deletedAt),
        pinned_at: dateToIso(turn.pinnedAt),
        archived: boolToInt(turn.archived),
    };
}

function rowToTurn(row: TurnRow): ConversationTurn {
    const rawToolCalls = jsonParse<Record<string, unknown>[]>(row.tool_calls);
    const rawTimeline = jsonParse<Record<string, unknown>[]>(row.timeline);

    let toolCalls: ToolCall[] | undefined;
    if (rawToolCalls && Array.isArray(rawToolCalls)) {
        toolCalls = [];
        for (const raw of rawToolCalls) {
            if (!raw || typeof raw !== 'object') continue;
            try {
                toolCalls.push(deserializeToolCall(raw));
            } catch (err) {
                logger.warn('sqlite-process-store', `Skipping malformed tool call in turn ${row.turn_index}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        if (toolCalls.length === 0) toolCalls = undefined;
    }

    let timeline: TimelineItem[] = [];
    if (rawTimeline && Array.isArray(rawTimeline)) {
        for (const raw of rawTimeline) {
            if (!raw || typeof raw !== 'object') continue;
            try {
                timeline.push(deserializeTimelineItem(raw));
            } catch (err) {
                logger.warn('sqlite-process-store', `Skipping malformed timeline item in turn ${row.turn_index}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }

    return {
        role: row.role as ConversationTurn['role'],
        content: row.content ?? '',
        timestamp: new Date(row.timestamp),
        turnIndex: row.turn_index,
        streaming: intToBool(row.streaming),
        interrupted: intToBool(row.interrupted),
        interruptionReason: row.interruption_reason ?? undefined,
        toolCalls,
        timeline,
        images: jsonParse<string[]>(row.images),
        historical: intToBool(row.historical),
        suggestions: jsonParse<string[]>(row.suggestions),
        tokenUsage: jsonParse<TokenUsage>(row.token_usage),
        pasteExternalized: intToBool(row.paste_externalized),
        ...(row.model ? { model: row.model } : {}),
        ...(row.mode ? { mode: row.mode } : {}),
        ...(row.sdk_event_id ? { sdkEventId: row.sdk_event_id } : {}),
        deletedAt: isoToDate(row.deleted_at),
        pinnedAt: isoToDate(row.pinned_at),
        archived: intToBool(row.archived),
    };
}

// ============================================================================
// Workspace ↔ Row conversion
// ============================================================================

function workspaceToRow(ws: WorkspaceInfo): Record<string, unknown> {
    return {
        id: ws.id,
        name: ws.name,
        root_path: ws.rootPath,
        color: ws.color ?? null,
        remote_url: ws.remoteUrl ?? null,
        description: ws.description ?? null,
        enabled_mcp_servers: ws.enabledMcpServers === null ? null :
            ws.enabledMcpServers !== undefined ? JSON.stringify(ws.enabledMcpServers) : null,
        disabled_skills: jsonStringify(ws.disabledSkills),
        extra_skill_folders: jsonStringify(ws.extraSkillFolders),
        virtual: boolToInt(ws.virtual),
    };
}

function rowToWorkspace(row: WorkspaceRow): WorkspaceInfo {
    const ws: WorkspaceInfo = {
        id: row.id,
        name: row.name,
        rootPath: row.root_path,
        color: row.color ?? undefined,
        remoteUrl: row.remote_url ?? undefined,
        description: row.description ?? undefined,
        virtual: intToBool(row.virtual),
    };

    // enabledMcpServers: null in DB means null/undefined; JSON string means parsed array
    if (row.enabled_mcp_servers !== null) {
        ws.enabledMcpServers = jsonParse<string[]>(row.enabled_mcp_servers);
    }
    if (row.disabled_skills !== null) {
        ws.disabledSkills = jsonParse<string[]>(row.disabled_skills);
    }
    if (row.extra_skill_folders !== null) {
        ws.extraSkillFolders = jsonParse<string[]>(row.extra_skill_folders);
    }

    return ws;
}

// ============================================================================
// Wiki ↔ Row conversion
// ============================================================================

function wikiToRow(wiki: WikiInfo): Record<string, unknown> {
    return {
        id: wiki.id,
        name: wiki.name,
        wiki_dir: wiki.wikiDir,
        repo_path: wiki.repoPath ?? null,
        color: wiki.color ?? null,
        ai_enabled: boolToInt(wiki.aiEnabled),
        registered_at: wiki.registeredAt,
    };
}

function rowToWiki(row: WikiRow): WikiInfo {
    return {
        id: row.id,
        name: row.name,
        wikiDir: row.wiki_dir,
        repoPath: row.repo_path ?? undefined,
        color: row.color ?? undefined,
        aiEnabled: !!row.ai_enabled,
        registeredAt: row.registered_at,
    };
}

// ============================================================================
// SqliteProcessStore
// ============================================================================

export class SqliteProcessStore implements ProcessStore {
    private readonly db: Database.Database;
    private readonly dbPath: string;
    private readonly emitters = new Map<string, EventEmitter>();
    private readonly flushHandlers = new Map<string, () => Promise<void>>();

    // Cached prepared statements
    private readonly insertProcessStmt: Statement;
    private readonly insertTurnStmt: Statement;
    private readonly getProcessStmt: Statement;
    private readonly getTurnsStmt: Statement;
    private readonly upsertStreamingStmt: Statement;
    private readonly maxTurnIndexStmt: Statement;

    onProcessChange?: ProcessChangeCallback;

    constructor(options: SqliteProcessStoreOptions) {
        this.dbPath = options.dbPath;
        this.db = new Database(options.dbPath);
        initializeDatabase(this.db);

        // Prepare cached statements
        this.insertProcessStmt = this.db.prepare(`
            INSERT INTO processes (
                id, workspace_id, type, prompt_preview, full_prompt, status,
                start_time, end_time, error, result, result_file_path,
                raw_stdout_file_path, metadata, group_metadata, structured_result,
                parent_process_id, sdk_session_id, backend, working_directory,
                title, custom_title, last_message_preview, token_limit, current_tokens,
                system_tokens, tool_definitions_tokens, conversation_tokens, cumulative_token_usage,
                stale, data_file_path, archived, pinned_at, last_event_at
            ) VALUES (
                @id, @workspace_id, @type, @prompt_preview, @full_prompt, @status,
                @start_time, @end_time, @error, @result, @result_file_path,
                @raw_stdout_file_path, @metadata, @group_metadata, @structured_result,
                @parent_process_id, @sdk_session_id, @backend, @working_directory,
                @title, @custom_title, @last_message_preview, @token_limit, @current_tokens,
                @system_tokens, @tool_definitions_tokens, @conversation_tokens, @cumulative_token_usage,
                @stale, @data_file_path, @archived, @pinned_at, @last_event_at
            )
        `);

        this.insertTurnStmt = this.db.prepare(`
            INSERT INTO conversation_turns (
                process_id, turn_index, role, content, timestamp, streaming,
                interrupted, interruption_reason, tool_calls, timeline, images, historical, suggestions,
                token_usage, paste_externalized, model, mode, sdk_event_id
            ) VALUES (
                @process_id, @turn_index, @role, @content, @timestamp, @streaming,
                @interrupted, @interruption_reason, @tool_calls, @timeline, @images, @historical, @suggestions,
                @token_usage, @paste_externalized, @model, @mode, @sdk_event_id
            )
        `);

        this.getProcessStmt = this.db.prepare(
            'SELECT * FROM processes WHERE id = ?'
        );

        this.getTurnsStmt = this.db.prepare(
            'SELECT * FROM conversation_turns WHERE process_id = ? ORDER BY turn_index'
        );

        this.upsertStreamingStmt = this.db.prepare(`
            UPDATE conversation_turns
            SET content = @content, timeline = @timeline, streaming = @streaming
            WHERE process_id = @process_id AND streaming = 1
        `);

        this.maxTurnIndexStmt = this.db.prepare(
            'SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_idx FROM conversation_turns WHERE process_id = ?'
        );
    }

    /**
     * Returns the underlying `better-sqlite3` Database instance.
     * Used by trusted callers (e.g. SqliteQueuePersistence) that need direct
     * access to the shared database connection.
     */
    getDatabase(): Database.Database {
        return this.db;
    }

    // ========================================================================
    // Process CRUD
    // ========================================================================

    async addProcess(process: AIProcess): Promise<void> {
        const addTxn = this.db.transaction((proc: AIProcess) => {
            const row = processToRow(proc);
            this.insertProcessStmt.run(row);
            for (const turn of proc.conversationTurns ?? []) {
                this.insertTurnStmt.run(turnToRow(turn, proc.id));
            }
        });
        addTxn(process);
        this.onProcessChange?.({ type: 'process-added', process });
    }

    async getProcess(id: string, _workspaceId?: string): Promise<AIProcess | undefined> {
        const row = this.getProcessStmt.get(id) as ProcessRow | undefined;
        if (!row) return undefined;
        const turnRows = this.getTurnsStmt.all(id) as TurnRow[];
        const turns = turnRows.map(rowToTurn);
        return rowToProcess(row, turns);
    }

    /**
     * Light-weight lookup for `pendingAskUser` counts across a set of running
     * processes. Avoids loading the full process row + all conversation turns
     * (`getProcess` does both) when callers only need to know whether a task
     * is awaiting user input.
     */
    getPendingAskUserCounts(processIds: readonly string[]): Map<string, number> {
        const result = new Map<string, number>();
        if (processIds.length === 0) return result;
        const placeholders = processIds.map(() => '?').join(',');
        const rows = this.db.prepare(
            `SELECT id, COALESCE(json_array_length(json_extract(metadata, '$.__pendingAskUser')), 0) AS cnt ` +
            `FROM processes WHERE id IN (${placeholders})`
        ).all(...processIds) as Array<{ id: string; cnt: number | null }>;
        for (const row of rows) {
            const count = typeof row.cnt === 'number' ? row.cnt : 0;
            if (count > 0) result.set(row.id, count);
        }
        return result;
    }

    getProcessBySdkSessionId(sdkSessionId: string): AIProcess | undefined {
        const row = this.db.prepare(
            'SELECT * FROM processes WHERE sdk_session_id = ? LIMIT 1'
        ).get(sdkSessionId) as ProcessRow | undefined;
        if (!row) return undefined;
        const turnRows = this.getTurnsStmt.all(row.id) as TurnRow[];
        return rowToProcess(row, turnRows.map(rowToTurn));
    }

    getSdkSessionIds(workspaceId: string): Set<string> {
        const rows = this.db.prepare(
            `SELECT DISTINCT sdk_session_id FROM processes
             WHERE workspace_id = ? AND sdk_session_id IS NOT NULL AND sdk_session_id <> ''`
        ).all(workspaceId) as Array<{ sdk_session_id: string }>;
        return new Set(rows.map(r => r.sdk_session_id));
    }

    async forkProcess(
        sourceId: string,
        newId: string,
        newSdkSessionId: string,
        upToTurnIndex?: number,
    ): Promise<AIProcess> {
        const forkTxn = this.db.transaction(() => {
            const sourceRow = this.getProcessStmt.get(sourceId) as ProcessRow | undefined;
            if (!sourceRow) throw new Error(`Source process not found: ${sourceId}`);

            const sourceProcess = rowToProcess(sourceRow);
            const sourceTitle = sourceProcess.title || sourceProcess.promptPreview || '';
            const forkTitle = `[Fork] ${sourceTitle}`;

            const metadata: Record<string, unknown> = {
                ...(jsonParse<Record<string, unknown>>(sourceRow.metadata) ?? {}),
                forkSourceId: sourceId,
            };

            const now = new Date();
            const newRow: Record<string, unknown> = {
                id: newId,
                workspace_id: sourceRow.workspace_id,
                type: sourceRow.type,
                prompt_preview: sourceRow.prompt_preview
                    ? `[Fork] ${sourceRow.prompt_preview}` : null,
                full_prompt: sourceRow.full_prompt,
                status: 'completed',
                start_time: now.toISOString(),
                end_time: now.toISOString(),
                error: null,
                result: null,
                result_file_path: null,
                raw_stdout_file_path: null,
                metadata: JSON.stringify(metadata),
                group_metadata: null,
                structured_result: null,
                parent_process_id: null,
                sdk_session_id: newSdkSessionId,
                backend: sourceRow.backend,
                working_directory: sourceRow.working_directory,
                title: forkTitle,
                custom_title: sourceRow.custom_title,
                last_message_preview: sourceRow.last_message_preview,
                token_limit: null,
                current_tokens: null,
                system_tokens: null,
                tool_definitions_tokens: null,
                conversation_tokens: null,
                cumulative_token_usage: null,
                stale: 0,
                data_file_path: null,
                archived: 0,
                pinned_at: null,
                last_event_at: now.toISOString(),
            };
            this.insertProcessStmt.run(newRow);

            // Copy conversation turns from source
            const turnFilter = upToTurnIndex != null
                ? ' AND turn_index <= ?'
                : '';
            const copyTurnsSQL = `
                INSERT INTO conversation_turns
                  (process_id, turn_index, role, content, timestamp, streaming,
                   interrupted, interruption_reason, tool_calls, timeline, images, historical, suggestions,
                   token_usage, paste_externalized, model, mode)
                SELECT
                  ?, turn_index, role, content, timestamp, 0,
                  interrupted, interruption_reason, tool_calls, timeline, images, 1, suggestions,
                  token_usage, paste_externalized, model, mode
                FROM conversation_turns
                WHERE process_id = ?
                  AND deleted_at IS NULL
                  ${turnFilter}
                ORDER BY turn_index
            `;
            const copyParams: unknown[] = [newId, sourceId];
            if (upToTurnIndex != null) copyParams.push(upToTurnIndex);
            this.db.prepare(copyTurnsSQL).run(...copyParams);

            // Read back the new process
            const newProcessRow = this.getProcessStmt.get(newId) as ProcessRow;
            const newTurnRows = this.getTurnsStmt.all(newId) as TurnRow[];
            return rowToProcess(newProcessRow, newTurnRows.map(rowToTurn));
        });

        const forked = forkTxn();
        this.onProcessChange?.({ type: 'process-added', process: forked });
        return forked;
    }

    async getAllProcesses(filter?: ProcessFilter): Promise<AIProcess[]> {
        const { sql, params } = this.buildProcessWhereClause(filter);

        const excludeConversation = filter?.exclude?.includes('conversation');
        const excludeToolCalls = filter?.exclude?.includes('toolCalls');

        // When the caller is only interested in the list-view fields (i.e. is
        // already discarding fullPrompt/result/conversation), skip reading the
        // heavy text columns from disk. For a workspace with 100 history items
        // whose prompts/results/structured_results can each be several KB,
        // this trims tens of KB to ~1 MB of I/O off every history fetch.
        const selectCols = excludeConversation
            ? `id, workspace_id, type, prompt_preview, NULL AS full_prompt, status, ` +
              `start_time, end_time, error, NULL AS result, result_file_path, ` +
              `raw_stdout_file_path, metadata, group_metadata, NULL AS structured_result, ` +
              `parent_process_id, sdk_session_id, backend, working_directory, ` +
              `title, custom_title, last_message_preview, token_limit, current_tokens, ` +
              `cumulative_token_usage, stale, data_file_path, archived, pinned_at, ` +
              `seen_at, last_event_at`
            : '*';
        const query = `SELECT ${selectCols} FROM processes ${sql} ORDER BY last_event_at DESC` +
            (filter?.limit !== undefined ? ` LIMIT ?` : '') +
            (filter?.offset !== undefined ? ` OFFSET ?` : '');

        const queryParams = [...params];
        if (filter?.limit !== undefined) queryParams.push(filter.limit);
        if (filter?.offset !== undefined) queryParams.push(filter.offset);

        // Use .iterate() to avoid materializing all rows at once
        const results: AIProcess[] = [];
        for (const row of this.db.prepare(query).iterate(...queryParams) as IterableIterator<ProcessRow>) {
            let turns: ConversationTurn[] | undefined;
            if (!excludeConversation) {
                const turnRows = this.getTurnsStmt.all(row.id) as TurnRow[];
                turns = turnRows.map(rowToTurn);
                if (excludeToolCalls && turns) {
                    turns = turns.map(t => {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { toolCalls, ...rest } = t;
                        return rest as ConversationTurn;
                    });
                }
            }

            const process = rowToProcess(row, turns);
            if (excludeConversation) {
                const { conversationTurns: _ct, fullPrompt: _fp, result: _r, ...rest } = process;
                results.push(rest as AIProcess);
            } else {
                results.push(process);
            }
        }
        return results;
    }

    async getProcessCount(filter?: ProcessFilter): Promise<number> {
        const { sql, params } = this.buildProcessWhereClause(filter);
        const row = this.db.prepare(`SELECT COUNT(*) AS cnt FROM processes ${sql}`).get(...params) as CountRow;
        return row.cnt;
    }

    async getProcessSummaries(filter?: ProcessFilter): Promise<{ entries: ProcessIndexEntry[]; total: number }> {
        const { sql, params } = this.buildProcessWhereClause(filter, true);

        // Total count (pre-pagination)
        const countQuery = `SELECT COUNT(*) AS cnt FROM processes ${sql}`;
        const countRow = this.db.prepare(countQuery).get(...params) as CountRow;
        const total = countRow.cnt;

        // Fetch summary columns with pagination. Derive `pending_ask_user_count` from
        // the metadata JSON envelope so list/sidebar views can show an "awaiting input"
        // indicator without loading the full process row.
        const selectQuery = `SELECT id, workspace_id, status, type, start_time, end_time, prompt_preview, error, parent_process_id, title, custom_title, last_message_preview, last_event_at, pinned_at, archived, ` +
            `COALESCE(json_array_length(json_extract(metadata, '$.__pendingAskUser')), 0) AS pending_ask_user_count ` +
            `FROM processes ${sql} ORDER BY last_event_at DESC` +
            (filter?.limit !== undefined ? ` LIMIT ?` : '') +
            (filter?.offset !== undefined ? ` OFFSET ?` : '');

        const queryParams = [...params];
        if (filter?.limit !== undefined) queryParams.push(filter.limit);
        if (filter?.offset !== undefined) queryParams.push(filter.offset);

        type SummaryRow = ProcessRow & { pending_ask_user_count?: number | null };

        const entries: ProcessIndexEntry[] = [];
        for (const row of this.db.prepare(selectQuery).iterate(...queryParams) as IterableIterator<SummaryRow>) {
            const startMs = new Date(row.start_time).getTime();
            const endMs = row.end_time ? new Date(row.end_time).getTime() : undefined;
            const askUserCount = typeof row.pending_ask_user_count === 'number' ? row.pending_ask_user_count : 0;
            entries.push({
                id: row.id,
                workspaceId: row.workspace_id,
                status: row.status,
                type: row.type || 'clarification',
                startTime: new Date(row.start_time).toISOString(),
                endTime: row.end_time ? new Date(row.end_time).toISOString() : undefined,
                promptPreview: row.prompt_preview ?? '',
                error: row.error ?? undefined,
                parentProcessId: row.parent_process_id ?? undefined,
                title: row.title ?? undefined,
                customTitle: row.custom_title ?? undefined,
                lastMessagePreview: row.last_message_preview ?? undefined,
                duration: endMs !== undefined ? endMs - startMs : undefined,
                lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : undefined,
                activityAt: new Date(row.last_event_at ?? row.start_time).toISOString(),
                pinnedAt: row.pinned_at ?? undefined,
                archived: intToBool(row.archived) || undefined,
                pendingAskUserCount: askUserCount > 0 ? askUserCount : undefined,
            });
        }

        return { entries, total };
    }

    async getProcessIds(filter?: ProcessFilter): Promise<string[]> {
        const { sql, params } = this.buildProcessWhereClause(filter);
        const query = `SELECT id FROM processes ${sql} ORDER BY last_event_at DESC`;
        // Use .iterate() to avoid materializing all ID rows at once
        const ids: string[] = [];
        for (const row of this.db.prepare(query).iterate(...params) as IterableIterator<{ id: string }>) {
            ids.push(row.id);
        }
        return ids;
    }

    async updateProcess(id: string, updates: Partial<AIProcess>): Promise<void> {
        if ('conversationTurns' in updates) {
            throw new Error('Use appendConversationTurn/upsertStreamingTurn/updateTurnContent to modify conversationTurns');
        }

        const setClauses: string[] = [];
        const values: unknown[] = [];

        const mapField = (column: string, value: unknown, transform?: (v: unknown) => unknown) => {
            if (value !== undefined) {
                setClauses.push(`${column} = ?`);
                values.push(transform ? transform(value) : value);
            }
        };

        mapField('type', updates.type);
        mapField('prompt_preview', updates.promptPreview);
        mapField('full_prompt', updates.fullPrompt);
        mapField('status', updates.status);
        mapField('start_time', updates.startTime, v => (v as Date).toISOString());
        mapField('end_time', updates.endTime, v => v ? (v as Date).toISOString() : null);
        mapField('error', updates.error);
        mapField('result', updates.result);
        mapField('result_file_path', updates.resultFilePath);
        mapField('raw_stdout_file_path', updates.rawStdoutFilePath);
        mapField('structured_result', updates.structuredResult);
        mapField('parent_process_id', updates.parentProcessId);
        mapField('sdk_session_id', updates.sdkSessionId);
        mapField('backend', updates.backend);
        mapField('working_directory', updates.workingDirectory);
        mapField('title', updates.title);
        mapField('custom_title', updates.customTitle, v => (v === '' ? null : v));
        mapField('last_message_preview', updates.lastMessagePreview, v => (v === '' ? null : v));
        mapField('token_limit', updates.tokenLimit);
        mapField('current_tokens', updates.currentTokens);
        mapField('system_tokens', updates.systemTokens);
        mapField('tool_definitions_tokens', updates.toolDefinitionsTokens);
        mapField('conversation_tokens', updates.conversationTokens);
        mapField('cumulative_token_usage', updates.cumulativeTokenUsage, v => jsonStringify(v));
        mapField('group_metadata', updates.groupMetadata, v => jsonStringify(v));
        if (updates.stale !== undefined) {
            setClauses.push('stale = ?');
            values.push(boolToInt(updates.stale));
        }
        mapField('data_file_path', updates.dataFilePath);
        mapField('pinned_at', updates.pinnedAt);
        if (updates.archived !== undefined) {
            setClauses.push('archived = ?');
            values.push(boolToInt(updates.archived));
        }

        // Handle metadata envelope rebuild when any metadata field changes
        if ('metadata' in updates || 'codeReviewMetadata' in updates ||
            'discoveryMetadata' in updates || 'codeReviewGroupMetadata' in updates ||
            'pendingMessages' in updates || 'pendingAskUser' in updates ||
            'pendingAskUserAnswer' in updates) {
            // Re-read existing process to merge metadata
            const existing = this.getProcessStmt.get(id) as ProcessRow | undefined;
            if (existing) {
                const existingEnvelope = jsonParse<MetadataEnvelope>(existing.metadata) ?? {};
                const { __codeReviewMetadata, __discoveryMetadata, __codeReviewGroupMetadata, __pendingMessages, __pendingAskUser, __pendingAskUserAnswer, ...existingMeta } = existingEnvelope;

                const newMeta = 'metadata' in updates ? (updates.metadata ?? {}) : existingMeta;
                const newCrm = 'codeReviewMetadata' in updates ? updates.codeReviewMetadata : __codeReviewMetadata;
                const newDm = 'discoveryMetadata' in updates ? updates.discoveryMetadata : __discoveryMetadata;
                const newCrgm = 'codeReviewGroupMetadata' in updates ? updates.codeReviewGroupMetadata : __codeReviewGroupMetadata;
                const newPm = 'pendingMessages' in updates ? updates.pendingMessages : __pendingMessages;
                const newAskUser = 'pendingAskUser' in updates ? updates.pendingAskUser : __pendingAskUser;
                const newAskUserAnswer = 'pendingAskUserAnswer' in updates ? updates.pendingAskUserAnswer : __pendingAskUserAnswer;

                const envelope: MetadataEnvelope = { ...(newMeta as object) };
                if (newCrm) envelope.__codeReviewMetadata = newCrm;
                if (newDm) envelope.__discoveryMetadata = newDm;
                if (newCrgm) envelope.__codeReviewGroupMetadata = newCrgm;
                if (newPm && (newPm as unknown[]).length > 0) envelope.__pendingMessages = newPm;
                if (newAskUser) envelope.__pendingAskUser = newAskUser;
                if (newAskUserAnswer) envelope.__pendingAskUserAnswer = newAskUserAnswer;

                const hasContent = Object.keys(envelope).length > 0;
                setClauses.push('metadata = ?');
                values.push(hasContent ? JSON.stringify(envelope) : null);
            }
        }

        if (setClauses.length === 0) return;

        values.push(id);
        const updateSql = `UPDATE processes SET ${setClauses.join(', ')} WHERE id = ?`;
        this.db.prepare(updateSql).run(...values);

        // Re-read for event
        const updated = await this.getProcess(id);
        if (updated) {
            this.onProcessChange?.({ type: 'process-updated', process: updated });
        }
    }

    async removeProcess(id: string): Promise<void> {
        const process = await this.getProcess(id);
        if (!process) return;
        this.db.prepare('DELETE FROM processes WHERE id = ?').run(id);
        this.onProcessChange?.({ type: 'process-removed', process });
    }

    async clearProcesses(filter?: ProcessFilter): Promise<number> {
        const { sql, params } = this.buildProcessWhereClause(filter);
        const result = this.db.prepare(`DELETE FROM processes ${sql}`).run(...params);
        this.onProcessChange?.({ type: 'processes-cleared' });
        return result.changes;
    }

    // ========================================================================
    // Pin & Archive Operations
    // ========================================================================

    pinProcess(id: string, pinnedAt: string): void {
        this.db.prepare('UPDATE processes SET pinned_at = ? WHERE id = ?').run(pinnedAt, id);
    }

    unpinProcess(id: string): void {
        this.db.prepare('UPDATE processes SET pinned_at = NULL WHERE id = ?').run(id);
    }

    archiveProcess(id: string): void {
        this.db.prepare('UPDATE processes SET archived = 1 WHERE id = ?').run(id);
    }

    unarchiveProcess(id: string): void {
        this.db.prepare('UPDATE processes SET archived = 0 WHERE id = ?').run(id);
    }

    archiveProcesses(ids: string[]): void {
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(', ');
        this.db.prepare(`UPDATE processes SET archived = 1 WHERE id IN (${placeholders})`).run(...ids);
    }

    unarchiveProcesses(ids: string[]): void {
        if (ids.length === 0) return;
        const placeholders = ids.map(() => '?').join(', ');
        this.db.prepare(`UPDATE processes SET archived = 0 WHERE id IN (${placeholders})`).run(...ids);
    }

    getPinnedProcesses(workspaceId: string): ProcessIndexEntry[] {
        const rows = this.db.prepare(
            'SELECT id, workspace_id, status, type, start_time, end_time, prompt_preview, error, parent_process_id, title, custom_title, last_message_preview, last_event_at, pinned_at, archived FROM processes WHERE workspace_id = ? AND pinned_at IS NOT NULL ORDER BY pinned_at DESC'
        ).all(workspaceId) as ProcessRow[];

        return rows.map(row => {
            const startMs = new Date(row.start_time).getTime();
            const endMs = row.end_time ? new Date(row.end_time).getTime() : undefined;
            return {
                id: row.id,
                workspaceId: row.workspace_id,
                status: row.status,
                type: row.type || 'clarification',
                startTime: new Date(row.start_time).toISOString(),
                endTime: row.end_time ? new Date(row.end_time).toISOString() : undefined,
                promptPreview: row.prompt_preview ?? '',
                error: row.error ?? undefined,
                parentProcessId: row.parent_process_id ?? undefined,
                title: row.title ?? undefined,
                customTitle: row.custom_title ?? undefined,
                lastMessagePreview: row.last_message_preview ?? undefined,
                duration: endMs !== undefined ? endMs - startMs : undefined,
                lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : undefined,
                pinnedAt: row.pinned_at ?? undefined,
                archived: intToBool(row.archived) || undefined,
            };
        });
    }

    // ========================================================================
    // Conversation Turn Actions (per-message delete, pin, archive)
    // ========================================================================

    /**
     * Soft-delete a conversation turn by setting `deleted_at`.
     * The turn is not physically removed — it can be restored via `restoreTurn()`.
     */
    softDeleteTurn(processId: string, turnIndex: number): void {
        const result = this.db.prepare(
            'UPDATE conversation_turns SET deleted_at = ? WHERE process_id = ? AND turn_index = ?'
        ).run(new Date().toISOString(), processId, turnIndex);
        if (result.changes > 0) {
            this.onProcessChange?.({ type: 'process-updated' });
        }
    }

    /**
     * Restore a soft-deleted conversation turn by clearing `deleted_at`.
     */
    restoreTurn(processId: string, turnIndex: number): void {
        const result = this.db.prepare(
            'UPDATE conversation_turns SET deleted_at = NULL WHERE process_id = ? AND turn_index = ?'
        ).run(processId, turnIndex);
        if (result.changes > 0) {
            this.onProcessChange?.({ type: 'process-updated' });
        }
    }

    /**
     * Permanently remove a soft-deleted turn from the database.
     */
    hardDeleteTurn(processId: string, turnIndex: number): void {
        this.db.prepare(
            'DELETE FROM conversation_turns WHERE process_id = ? AND turn_index = ? AND deleted_at IS NOT NULL'
        ).run(processId, turnIndex);
    }

    /**
     * Pin a conversation turn within a process.
     */
    pinTurn(processId: string, turnIndex: number, pinnedAt: string): void {
        const result = this.db.prepare(
            'UPDATE conversation_turns SET pinned_at = ?, archived = 0 WHERE process_id = ? AND turn_index = ?'
        ).run(pinnedAt, processId, turnIndex);
        if (result.changes > 0) {
            this.onProcessChange?.({ type: 'process-updated' });
        }
    }

    /**
     * Unpin a conversation turn.
     */
    unpinTurn(processId: string, turnIndex: number): void {
        const result = this.db.prepare(
            'UPDATE conversation_turns SET pinned_at = NULL WHERE process_id = ? AND turn_index = ?'
        ).run(processId, turnIndex);
        if (result.changes > 0) {
            this.onProcessChange?.({ type: 'process-updated' });
        }
    }

    /**
     * Archive a conversation turn (collapse/hide).
     */
    archiveTurn(processId: string, turnIndex: number): void {
        const result = this.db.prepare(
            'UPDATE conversation_turns SET archived = 1 WHERE process_id = ? AND turn_index = ?'
        ).run(processId, turnIndex);
        if (result.changes > 0) {
            this.onProcessChange?.({ type: 'process-updated' });
        }
    }

    /**
     * Unarchive a conversation turn.
     */
    unarchiveTurn(processId: string, turnIndex: number): void {
        const result = this.db.prepare(
            'UPDATE conversation_turns SET archived = 0 WHERE process_id = ? AND turn_index = ?'
        ).run(processId, turnIndex);
        if (result.changes > 0) {
            this.onProcessChange?.({ type: 'process-updated' });
        }
    }

    /**
     * Get all pinned turns for a process.
     */
    getPinnedTurns(processId: string): ConversationTurn[] {
        const rows = this.db.prepare(
            'SELECT * FROM conversation_turns WHERE process_id = ? AND pinned_at IS NOT NULL AND deleted_at IS NULL ORDER BY pinned_at DESC'
        ).all(processId) as TurnRow[];
        return rows.map(rowToTurn);
    }

    // ========================================================================
    // Conversation Turn Operations
    // ========================================================================

    async upsertStreamingTurn(
        processId: string,
        content: string,
        streaming: boolean,
        timeline?: TimelineItem[],
    ): Promise<void> {
        const upsertTxn = this.db.transaction(() => {
            const result = this.upsertStreamingStmt.run({
                content,
                timeline: JSON.stringify((timeline ?? []).map(serializeTimelineItem)),
                streaming: boolToInt(streaming),
                process_id: processId,
            });

            if (result.changes === 0) {
                // No existing streaming turn — insert new one
                const { next_idx } = this.maxTurnIndexStmt.get(processId) as MaxTurnIndexRow;
                this.insertTurnStmt.run({
                    process_id: processId,
                    turn_index: next_idx,
                    role: 'assistant',
                    content,
                    timestamp: new Date().toISOString(),
                    streaming: boolToInt(streaming),
                    interrupted: 0,
                    interruption_reason: null,
                    tool_calls: null,
                    timeline: JSON.stringify((timeline ?? []).map(serializeTimelineItem)),
                    images: null,
                    historical: 0,
                    suggestions: null,
                    token_usage: null,
                    paste_externalized: 0,
                    model: null,
                    mode: null,
                    sdk_event_id: null,
                });
            }
        });
        upsertTxn();
        this.onProcessChange?.({ type: 'process-updated' });
    }

    async appendConversationTurn(
        processId: string,
        makeTurn: (turnIndex: number) => ConversationTurn,
        options?: {
            filterStreaming?: boolean;
            additionalUpdates?:
                | Partial<Omit<AIProcess, 'conversationTurns'>>
                | ((current: AIProcess) => Partial<Omit<AIProcess, 'conversationTurns'>>);
        }
    ): Promise<{ turn: ConversationTurn; allTurns: ConversationTurn[] } | undefined> {
        let appendResult: { turn: ConversationTurn; allTurns: ConversationTurn[] } | undefined;

        const appendTxn = this.db.transaction(() => {
            // Check process exists
            const processRow = this.getProcessStmt.get(processId) as ProcessRow | undefined;
            if (!processRow) return;

            let stableTurnIndex: number | undefined;

            if (options?.filterStreaming) {
                // Find streaming turn index before deleting
                const streamingRow = this.db.prepare(
                    "SELECT turn_index FROM conversation_turns WHERE process_id = ? AND streaming = 1 AND role = 'assistant'"
                ).get(processId) as StreamingTurnRow | undefined;

                if (streamingRow) {
                    stableTurnIndex = streamingRow.turn_index;
                }

                // Delete streaming turns
                this.db.prepare(
                    'DELETE FROM conversation_turns WHERE process_id = ? AND streaming = 1'
                ).run(processId);

                // Guard: discard stale stableTurnIndex if a new turn was appended after it
                if (stableTurnIndex !== undefined) {
                    const maxRow = this.db.prepare(
                        'SELECT COALESCE(MAX(turn_index), -1) AS max_idx FROM conversation_turns WHERE process_id = ?'
                    ).get(processId) as { max_idx: number };
                    if (stableTurnIndex <= maxRow.max_idx) {
                        stableTurnIndex = undefined;
                    }
                }
            }

            // Compute fallback index
            const { next_idx } = this.maxTurnIndexStmt.get(processId) as MaxTurnIndexRow;
            const turn = makeTurn(stableTurnIndex ?? next_idx);

            // Insert the new turn
            this.insertTurnStmt.run(turnToRow(turn, processId));

            // Update last_event_at to current time. Refresh the denormalized
            // last_message_preview snapshot only when the new turn is a USER
            // message — the sidebar shows this as the "latest user prompt"
            // fallback when no custom title is set.
            const previewText = turn.role === 'user'
                ? computeMessagePreview(turn.content)
                : undefined;
            if (previewText !== undefined) {
                this.db.prepare('UPDATE processes SET last_event_at = ?, last_message_preview = ? WHERE id = ?')
                    .run(new Date().toISOString(), previewText, processId);
            } else {
                this.db.prepare('UPDATE processes SET last_event_at = ? WHERE id = ?')
                    .run(new Date().toISOString(), processId);
            }

            // Apply additional updates
            if (options?.additionalUpdates) {
                const currentProcess = rowToProcess(processRow);
                const extraUpdates = typeof options.additionalUpdates === 'function'
                    ? options.additionalUpdates(currentProcess)
                    : options.additionalUpdates;

                if (extraUpdates && Object.keys(extraUpdates).length > 0) {
                    this.applyProcessUpdatesInline(processId, extraUpdates, processRow);
                }
            }

            // Read all turns for return value
            const allTurnRows = this.getTurnsStmt.all(processId) as TurnRow[];
            const allTurns = allTurnRows.map(rowToTurn);

            appendResult = { turn, allTurns };
        });

        appendTxn();

        if (appendResult) {
            const updated = await this.getProcess(processId);
            this.onProcessChange?.({ type: 'process-updated', process: updated ?? undefined });
        }

        return appendResult;
    }

    async updateTurnContent(
        processId: string,
        turnIndex: number,
        content: string,
    ): Promise<void> {
        const result = this.db.prepare(
            'UPDATE conversation_turns SET content = ? WHERE process_id = ? AND turn_index = ?'
        ).run(content, processId, turnIndex);

        if (result.changes === 0) {
            getLogger().warn('SqliteProcessStore', `Turn not found: processId=${processId}, turnIndex=${turnIndex}`);
        }
        this.onProcessChange?.({ type: 'process-updated' });
    }

    async updateTurnSdkEventId(
        processId: string,
        turnIndex: number,
        sdkEventId: string,
    ): Promise<void> {
        const result = this.db.prepare(
            "UPDATE conversation_turns SET sdk_event_id = ? WHERE process_id = ? AND turn_index = ? AND role = 'user'"
        ).run(sdkEventId, processId, turnIndex);

        if (result.changes === 0) {
            getLogger().warn('SqliteProcessStore', `User turn not found for sdkEventId update: processId=${processId}, turnIndex=${turnIndex}`);
        }
        this.onProcessChange?.({ type: 'process-updated' });
    }

    async truncateConversationTurns(
        processId: string,
        fromTurnIndex: number,
    ): Promise<{ removed: ConversationTurn[]; allTurns: ConversationTurn[] } | undefined> {
        let result: { removed: ConversationTurn[]; allTurns: ConversationTurn[] } | undefined;

        const txn = this.db.transaction(() => {
            const processRow = this.getProcessStmt.get(processId) as ProcessRow | undefined;
            if (!processRow) return;

            // Snapshot the turns being dropped (turn_index >= fromTurnIndex), in order,
            // so the caller can repopulate the composer from the removed user message.
            const removedRows = this.db.prepare(
                'SELECT * FROM conversation_turns WHERE process_id = ? AND turn_index >= ? ORDER BY turn_index'
            ).all(processId, fromTurnIndex) as TurnRow[];
            const removed = removedRows.map(rowToTurn);

            // Hard-delete them — destructive in-place truncation, mirroring the SDK
            // history events that a rewind permanently drops.
            this.db.prepare(
                'DELETE FROM conversation_turns WHERE process_id = ? AND turn_index >= ?'
            ).run(processId, fromTurnIndex);

            // Recompute conversation-derived process metadata from the survivors.
            // Remaining turns keep their original turn_index (no renumbering).
            const allTurnRows = this.getTurnsStmt.all(processId) as TurnRow[];
            const allTurns = allTurnRows.map(rowToTurn);
            const lastTurn = allTurns[allTurns.length - 1];
            const lastUserTurn = [...allTurns].reverse().find(t => t.role === 'user');
            const lastEventAt = lastTurn ? lastTurn.timestamp.toISOString() : null;
            const lastMessagePreview = lastUserTurn ? (computeMessagePreview(lastUserTurn.content) ?? null) : null;
            this.db.prepare('UPDATE processes SET last_event_at = ?, last_message_preview = ? WHERE id = ?')
                .run(lastEventAt, lastMessagePreview, processId);

            result = { removed, allTurns };
        });

        txn();

        if (result) {
            const updated = await this.getProcess(processId);
            this.onProcessChange?.({ type: 'process-updated', process: updated ?? undefined });
        }
        return result;
    }

    // ========================================================================
    // Workspace CRUD
    // ========================================================================

    async registerWorkspace(workspace: WorkspaceInfo): Promise<void> {
        const row = workspaceToRow(workspace);
        this.db.prepare(`
            INSERT OR REPLACE INTO workspaces (
                id, name, root_path, color, remote_url, description,
                enabled_mcp_servers, disabled_skills, extra_skill_folders, virtual
            ) VALUES (
                @id, @name, @root_path, @color, @remote_url, @description,
                @enabled_mcp_servers, @disabled_skills, @extra_skill_folders, @virtual
            )
        `).run(row);
    }

    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        const rows = this.db.prepare('SELECT * FROM workspaces').all() as WorkspaceRow[];
        return rows.map(rowToWorkspace);
    }

    async removeWorkspace(id: string): Promise<boolean> {
        const result = this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
        return result.changes > 0;
    }

    async updateWorkspace(id: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): Promise<WorkspaceInfo | undefined> {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name); }
        if (updates.rootPath !== undefined) { setClauses.push('root_path = ?'); values.push(updates.rootPath); }
        if (updates.color !== undefined) { setClauses.push('color = ?'); values.push(updates.color); }
        if (updates.remoteUrl !== undefined) { setClauses.push('remote_url = ?'); values.push(updates.remoteUrl); }
        if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description); }
        if ('enabledMcpServers' in updates) {
            setClauses.push('enabled_mcp_servers = ?');
            values.push(updates.enabledMcpServers === null ? null :
                updates.enabledMcpServers !== undefined ? JSON.stringify(updates.enabledMcpServers) : null);
        }
        if ('disabledSkills' in updates) {
            setClauses.push('disabled_skills = ?');
            values.push(jsonStringify(updates.disabledSkills));
        }
        if ('extraSkillFolders' in updates) {
            setClauses.push('extra_skill_folders = ?');
            values.push(jsonStringify(updates.extraSkillFolders));
        }
        if (updates.virtual !== undefined) { setClauses.push('virtual = ?'); values.push(boolToInt(updates.virtual)); }

        if (setClauses.length === 0) {
            // No updates, just return existing
            const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
            return row ? rowToWorkspace(row) : undefined;
        }

        values.push(id);
        this.db.prepare(`UPDATE workspaces SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

        const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
        return row ? rowToWorkspace(row) : undefined;
    }

    /**
     * Re-key every reference to a physical workspace from `oldId` to `newId`
     * inside this database, in a single transaction. Covers the workspace
     * record, process history (and the seen/unseen state carried on those
     * rows), process metadata, workspace-scoped bindings, task-group records,
     * loop/container routing references, and queued/scheduled work keyed by
     * repo id. Returns false without changing anything when `oldId` is unknown
     * or a workspace `newId` already exists, so the startup migration can treat
     * a false result as a conflict and never merge two workspaces.
     */
    async renameWorkspaceId(oldId: string, newId: string): Promise<boolean> {
        if (!oldId || !newId || oldId === newId) {
            return false;
        }
        const run = this.db.transaction((): boolean => {
            const source = this.db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(oldId);
            if (!source) {
                return false;
            }
            const target = this.db.prepare('SELECT 1 FROM workspaces WHERE id = ?').get(newId);
            if (target) {
                // A workspace already owns newId — never silently merge into it.
                return false;
            }
            this.rewriteProcessMetadataWorkspaceId(oldId, newId);
            this.db.prepare('UPDATE workspaces SET id = ? WHERE id = ?').run(newId, oldId);
            this.db.prepare('UPDATE processes SET workspace_id = ? WHERE workspace_id = ?').run(newId, oldId);
            for (const { table, column } of WORKSPACE_ID_REFERENCE_COLUMNS) {
                if (!this.columnExists(table, column)) { continue; }
                this.db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(newId, oldId);
            }
            return true;
        });
        return run();
    }

    private rewriteProcessMetadataWorkspaceId(oldId: string, newId: string): void {
        const rows = this.db.prepare(
            'SELECT id, metadata FROM processes WHERE workspace_id = ?',
        ).all(oldId) as Array<{ id: string; metadata: string | null }>;
        if (rows.length === 0) {
            return;
        }

        const update = this.db.prepare('UPDATE processes SET metadata = ? WHERE id = ?');
        for (const row of rows) {
            const envelope = jsonParse<MetadataEnvelope>(row.metadata) ?? {};
            update.run(JSON.stringify({ ...envelope, workspaceId: newId }), row.id);
        }
    }

    /** True when a table with the given name exists in this database. */
    private tableExists(name: string): boolean {
        return (
            this.db
                .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
                .get(name) !== undefined
        );
    }

    private columnExists(table: string, column: string): boolean {
        if (!this.tableExists(table)) {
            return false;
        }
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        return columns.some(info => info.name === column);
    }

    // ========================================================================
    // Wiki CRUD
    // ========================================================================

    async registerWiki(wiki: WikiInfo): Promise<void> {
        const row = wikiToRow(wiki);
        this.db.prepare(`
            INSERT OR REPLACE INTO wikis (
                id, name, wiki_dir, repo_path, color, ai_enabled, registered_at
            ) VALUES (
                @id, @name, @wiki_dir, @repo_path, @color, @ai_enabled, @registered_at
            )
        `).run(row);
    }

    async getWikis(): Promise<WikiInfo[]> {
        const rows = this.db.prepare('SELECT * FROM wikis').all() as WikiRow[];
        return rows.map(rowToWiki);
    }

    async removeWiki(id: string): Promise<boolean> {
        const result = this.db.prepare('DELETE FROM wikis WHERE id = ?').run(id);
        return result.changes > 0;
    }

    async updateWiki(id: string, updates: Partial<Omit<WikiInfo, 'id'>>): Promise<WikiInfo | undefined> {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name); }
        if (updates.wikiDir !== undefined) { setClauses.push('wiki_dir = ?'); values.push(updates.wikiDir); }
        if (updates.repoPath !== undefined) { setClauses.push('repo_path = ?'); values.push(updates.repoPath); }
        if (updates.color !== undefined) { setClauses.push('color = ?'); values.push(updates.color); }
        if (updates.aiEnabled !== undefined) { setClauses.push('ai_enabled = ?'); values.push(boolToInt(updates.aiEnabled)); }
        if (updates.registeredAt !== undefined) { setClauses.push('registered_at = ?'); values.push(updates.registeredAt); }

        if (setClauses.length === 0) {
            const row = this.db.prepare('SELECT * FROM wikis WHERE id = ?').get(id) as WikiRow | undefined;
            return row ? rowToWiki(row) : undefined;
        }

        values.push(id);
        this.db.prepare(`UPDATE wikis SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);

        const row = this.db.prepare('SELECT * FROM wikis WHERE id = ?').get(id) as WikiRow | undefined;
        return row ? rowToWiki(row) : undefined;
    }

    // ========================================================================
    // Admin: bulk clear & stats
    // ========================================================================

    async clearAllWorkspaces(): Promise<number> {
        const result = this.db.prepare('DELETE FROM workspaces').run();
        return result.changes;
    }

    async clearAllWikis(): Promise<number> {
        const result = this.db.prepare('DELETE FROM wikis').run();
        return result.changes;
    }

    async getStorageStats(): Promise<StorageStats> {
        const procCount = (this.db.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as CountRow).cnt;
        const wsCount = (this.db.prepare('SELECT COUNT(*) AS cnt FROM workspaces').get() as CountRow).cnt;
        const wikiCount = (this.db.prepare('SELECT COUNT(*) AS cnt FROM wikis').get() as CountRow).cnt;

        let storageSize = 0;
        try {
            storageSize = fs.statSync(this.dbPath).size;
        } catch {
            // File may not exist yet
        }

        return {
            totalProcesses: procCount,
            totalWorkspaces: wsCount,
            totalWikis: wikiCount,
            storageSize,
        };
    }

    // ========================================================================
    // EventEmitter Bus
    // ========================================================================

    onProcessOutput(id: string, callback: (event: ProcessOutputEvent) => void): () => void {
        const emitter = this.getOrCreateEmitter(id);
        const listener = (event: ProcessOutputEvent) => callback(event);
        emitter.on('output', listener);
        return () => {
            emitter.removeListener('output', listener);
        };
    }

    emitProcessOutput(id: string, content: string): void {
        const emitter = this.getOrCreateEmitter(id);
        const event: ProcessOutputEvent = { type: 'chunk', content };
        emitter.emit('output', event);
    }

    emitProcessComplete(id: string, status: AIProcessStatus, duration: string): void {
        const emitter = this.emitters.get(id);
        if (!emitter) return;
        const event: ProcessOutputEvent = { type: 'complete', status, duration };
        emitter.emit('output', event);
        this.emitters.delete(id);
    }

    emitProcessEvent(id: string, event: ProcessOutputEvent): void {
        const emitter = this.getOrCreateEmitter(id);
        emitter.emit('output', event);
    }

    // ========================================================================
    // Flush Handlers
    // ========================================================================

    registerFlushHandler(id: string, handler: () => Promise<void>): void {
        this.flushHandlers.set(id, handler);
    }

    unregisterFlushHandler(id: string): void {
        this.flushHandlers.delete(id);
    }

    async requestFlush(id: string): Promise<void> {
        const handler = this.flushHandlers.get(id);
        if (handler) { await handler(); }
    }

    // ========================================================================
    // Seen state (read/unread tracking)
    // ========================================================================

    /**
     * Get the seen map for a workspace: processId → seenAt timestamp.
     */
    getSeenMap(workspaceId: string): Record<string, string> {
        const rows = this.db.prepare(
            'SELECT id, seen_at FROM processes WHERE workspace_id = ? AND seen_at IS NOT NULL'
        ).all(workspaceId) as Array<{ id: string; seen_at: string }>;
        const map: Record<string, string> = {};
        for (const row of rows) {
            map[row.id] = row.seen_at;
        }
        return map;
    }

    /**
     * Mark a single process as seen.
     */
    markSeen(processId: string, seenAt: string): void {
        this.db.prepare('UPDATE processes SET seen_at = ? WHERE id = ?').run(seenAt, processId);
    }

    /**
     * Batch-mark multiple processes as seen within a single transaction.
     */
    markManySeen(entries: Array<{ processId: string; seenAt: string }>): void {
        const stmt = this.db.prepare('UPDATE processes SET seen_at = ? WHERE id = ?');
        const batch = this.db.transaction((items: Array<{ processId: string; seenAt: string }>) => {
            for (const { processId, seenAt } of items) {
                stmt.run(seenAt, processId);
            }
        });
        batch(entries);
    }

    /**
     * Mark a process as unseen (set seen_at to NULL).
     */
    markUnseen(processId: string): void {
        this.db.prepare('UPDATE processes SET seen_at = NULL WHERE id = ?').run(processId);
    }

    /**
     * Count unseen completed/failed processes for a workspace.
     * A process is "unseen" when seen_at IS NULL or seen_at != end_time.
     */
    getUnseenCount(workspaceId: string): number {
        const row = this.db.prepare(
            `SELECT COUNT(*) as cnt FROM processes
             WHERE workspace_id = ?
               AND status IN ('completed', 'failed')
               AND end_time IS NOT NULL
               AND (seen_at IS NULL OR seen_at != end_time)`
        ).get(workspaceId) as { cnt: number };
        return row.cnt;
    }

    // ========================================================================
    // Full-text search
    // ========================================================================

    /**
     * Sanitize a raw user query into safe FTS5 syntax.
     * Strips FTS5 operator characters that could cause parse errors,
     * and wraps each term as a simple token.
     */
    private sanitizeFtsQuery(raw: string): string {
        // Remove FTS5 special characters: * ^ : { } ( )
        let cleaned = raw.replace(/[*^:{}()]/g, '');
        // Escape double-quotes by removing them (prevents malformed phrase queries)
        cleaned = cleaned.replace(/"/g, '');
        // Replace hyphens with spaces to prevent FTS5 NOT operator interpretation
        cleaned = cleaned.replace(/-/g, ' ');
        // Collapse whitespace and trim
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        return cleaned;
    }

    async searchConversations(
        query: string,
        filter?: SearchFilter
    ): Promise<{ results: ConversationSearchResult[]; total: number }> {
        const empty = { results: [], total: 0 };

        const sanitized = this.sanitizeFtsQuery(query);
        if (!sanitized) return empty;

        const params: unknown[] = [sanitized];
        const whereClauses = ['conversation_search MATCH ?', 'p.archived = 0'];

        if (filter?.workspaceId) {
            whereClauses.push('p.workspace_id = ?');
            params.push(filter.workspaceId);
        }

        if (filter?.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            whereClauses.push(`p.status IN (${statuses.map(() => '?').join(', ')})`);
            params.push(...statuses);
        }

        if (filter?.type) {
            whereClauses.push('p.type = ?');
            params.push(filter.type);
        }

        if (filter?.since) {
            whereClauses.push('p.last_event_at >= ?');
            params.push(filter.since.toISOString());
        }

        if (filter?.until) {
            whereClauses.push('p.last_event_at < ?');
            params.push(filter.until.toISOString());
        }

        const whereSQL = whereClauses.join(' AND ');
        const limit = filter?.limit ?? 50;
        const offset = filter?.offset ?? 0;

        try {
            // Count total results (pre-pagination)
            const countSQL = `
                SELECT COUNT(*) as cnt
                FROM conversation_search cs
                JOIN conversation_turns ct ON ct.id = cs.rowid
                JOIN processes p ON ct.process_id = p.id
                WHERE ${whereSQL}
            `;
            const countRow = this.db.prepare(countSQL).get(...params) as { cnt: number };
            const total = countRow.cnt;

            if (total === 0) return empty;

            // Fetch paginated results with snippets
            const resultsSQL = `
                SELECT
                    ct.process_id,
                    ct.turn_index,
                    ct.role,
                    snippet(conversation_search, 0, '<mark>', '</mark>', '…', 48) AS snippet,
                    cs.rank,
                    p.title AS process_title,
                    p.prompt_preview,
                    p.status AS process_status,
                    p.type AS process_type,
                    p.workspace_id,
                    p.start_time
                FROM conversation_search cs
                JOIN conversation_turns ct ON ct.id = cs.rowid
                JOIN processes p ON ct.process_id = p.id
                WHERE ${whereSQL}
                ORDER BY cs.rank
                LIMIT ? OFFSET ?
            `;
            const rows = this.db.prepare(resultsSQL).all(...params, limit, offset) as Array<{
                process_id: string;
                turn_index: number;
                role: string;
                snippet: string;
                rank: number;
                process_title: string | null;
                prompt_preview: string | null;
                process_status: string;
                process_type: string;
                workspace_id: string;
                start_time: string;
            }>;

            const results: ConversationSearchResult[] = rows.map(row => ({
                processId: row.process_id,
                turnIndex: row.turn_index,
                role: row.role,
                snippet: row.snippet,
                rank: row.rank,
                processTitle: row.process_title ?? undefined,
                promptPreview: row.prompt_preview ?? '',
                processStatus: row.process_status,
                processType: row.process_type,
                workspaceId: row.workspace_id,
                startTime: row.start_time,
            }));

            return { results, total };
        } catch (err) {
            // Graceful degradation: malformed FTS5 queries return empty results
            logger.warn('searchConversations', `FTS5 query failed for "${sanitized}": ${String(err)}`);
            return empty;
        }
    }

    // ========================================================================
    // Prompt Autocomplete
    // ========================================================================

    /**
     * Find the single best inline-completion suffix for the given user prefix.
     *
     * Searches both initial prompts (`processes.full_prompt`) and user
     * follow-up turns (`conversation_turns.content WHERE role='user'`),
     * scoped globally (no workspace filter). Returns only the *suffix* the
     * client should append after the typed text, or `null` when nothing useful
     * matches.
     *
     * Ranking: most-frequent matching historical text wins, then most recent,
     * then shortest completion.
     */
    getBestPromptCompletion(
        rawPrefix: string,
        opts?: { minPrefixLen?: number },
    ): { completion: string; source: 'initial' | 'follow-up' } | null {
        const minLen = opts?.minPrefixLen ?? 3;
        // Strip leading whitespace; we match historical text from its start.
        const trimmed = (rawPrefix ?? '').replace(/^\s+/, '');
        if (trimmed.length < minLen) return null;
        if (trimmed.length > 500) return null;

        // Escape SQL LIKE wildcards in the user-supplied prefix.
        const escaped = trimmed.replace(/[\\%_]/g, c => '\\' + c);
        const likePattern = escaped + '%';
        const prefLen = trimmed.length;

        const sql = `
            WITH candidates AS (
                SELECT p.full_prompt AS text, p.start_time AS ts, 'initial' AS src
                FROM processes p
                WHERE p.archived = 0
                  AND p.full_prompt IS NOT NULL
                  AND p.full_prompt LIKE ? ESCAPE '\\'
                  AND length(p.full_prompt) > ?
                UNION ALL
                SELECT ct.content AS text, ct.timestamp AS ts, 'follow-up' AS src
                FROM conversation_turns ct
                WHERE ct.role = 'user'
                  AND ct.deleted_at IS NULL
                  AND COALESCE(ct.archived, 0) = 0
                  AND ct.content IS NOT NULL
                  AND ct.content LIKE ? ESCAPE '\\'
                  AND length(ct.content) > ?
            )
            SELECT text, COUNT(*) AS cnt, MAX(ts) AS max_ts, MIN(src) AS src
            FROM candidates
            GROUP BY text COLLATE NOCASE
            ORDER BY cnt DESC, max_ts DESC, length(text) ASC
            LIMIT 1
        `;

        try {
            const row = this.db
                .prepare(sql)
                .get(likePattern, prefLen, likePattern, prefLen) as
                | { text: string; cnt: number; max_ts: string; src: string }
                | undefined;
            if (!row) return null;
            // Strip exactly the prefix length from the historical text.
            // We matched LIKE which is case-insensitive in SQLite for ASCII,
            // so the historical text's first `prefLen` characters may differ
            // in case from the user's typed prefix. We always return the
            // historical text's suffix verbatim.
            const completion = row.text.slice(prefLen);
            if (!completion) return null;
            return { completion, source: row.src as 'initial' | 'follow-up' };
        } catch (err) {
            logger.warn(
                'getBestPromptCompletion',
                `Query failed for prefix "${trimmed.slice(0, 32)}…": ${String(err)}`,
            );
            return null;
        }
    }

    getPromptAutocompleteContext(
        rawPrefix: string,
        opts?: {
            workspaceId?: string;
            processId?: string;
            limit?: number;
            includeGlobalHistory?: boolean;
        },
    ): PromptAutocompleteContext {
        const trimmed = (rawPrefix ?? '').replace(/^\s+/, '');
        const limit = Math.max(1, Math.min(opts?.limit ?? 12, 50));
        const includeGlobalHistory = opts?.includeGlobalHistory === true;
        const workspaceId = opts?.workspaceId;
        const processId = opts?.processId;
        const scoped = includeGlobalHistory || !!workspaceId;

        if (!scoped) {
            return {
                exactPrefixMatches: [],
                recentWorkspacePrompts: [],
                recentProcessTurns: [],
                historyFingerprint: '0::0',
            };
        }

        const escaped = trimmed.replace(/[\\%_]/g, c => '\\' + c);
        const likePattern = escaped + '%';
        const params = { workspaceId: workspaceId ?? '', processId: processId ?? '', likePattern, limit };
        const processScope = includeGlobalHistory ? '' : 'AND p.workspace_id = @workspaceId';
        const turnProcessScope = includeGlobalHistory ? '' : 'AND p.workspace_id = @workspaceId';

        const exactPrefixMatches = this.mapPromptAutocompleteRows(
            this.db.prepare(`
                SELECT p.full_prompt AS text, 'initial' AS source, p.workspace_id AS workspaceId,
                       p.id AS processId, p.start_time AS timestamp
                FROM processes p
                WHERE p.archived = 0
                  AND p.full_prompt IS NOT NULL
                  AND length(trim(p.full_prompt)) > 0
                  AND p.full_prompt LIKE @likePattern ESCAPE '\\'
                  ${processScope}
                UNION ALL
                SELECT ct.content AS text, 'follow-up' AS source, p.workspace_id AS workspaceId,
                       ct.process_id AS processId, ct.timestamp AS timestamp
                FROM conversation_turns ct
                JOIN processes p ON p.id = ct.process_id
                WHERE p.archived = 0
                  AND ct.role = 'user'
                  AND ct.deleted_at IS NULL
                  AND COALESCE(ct.archived, 0) = 0
                  AND ct.content IS NOT NULL
                  AND length(trim(ct.content)) > 0
                  AND ct.content LIKE @likePattern ESCAPE '\\'
                  ${turnProcessScope}
                ORDER BY timestamp DESC
                LIMIT @limit
            `).all(params) as PromptAutocompleteHistoryRow[],
            trimmed,
        );

        const recentWorkspacePrompts = this.mapPromptAutocompleteRows(
            this.db.prepare(`
                SELECT p.full_prompt AS text, 'initial' AS source, p.workspace_id AS workspaceId,
                       p.id AS processId, p.start_time AS timestamp
                FROM processes p
                WHERE p.archived = 0
                  AND p.full_prompt IS NOT NULL
                  AND length(trim(p.full_prompt)) > 0
                  ${processScope}
                ORDER BY p.start_time DESC
                LIMIT @limit
            `).all(params) as PromptAutocompleteHistoryRow[],
            trimmed,
        );

        const recentProcessTurns = processId
            ? this.mapPromptAutocompleteRows(
                this.db.prepare(`
                    SELECT ct.content AS text, 'follow-up' AS source, p.workspace_id AS workspaceId,
                           ct.process_id AS processId, ct.timestamp AS timestamp
                    FROM conversation_turns ct
                    JOIN processes p ON p.id = ct.process_id
                    WHERE p.archived = 0
                      AND ct.process_id = @processId
                      AND ct.role = 'user'
                      AND ct.deleted_at IS NULL
                      AND COALESCE(ct.archived, 0) = 0
                      AND ct.content IS NOT NULL
                      AND length(trim(ct.content)) > 0
                      ${turnProcessScope}
                    ORDER BY ct.timestamp DESC
                    LIMIT @limit
                `).all(params) as PromptAutocompleteHistoryRow[],
                trimmed,
            )
            : [];

        const allItems = [
            ...exactPrefixMatches,
            ...recentWorkspacePrompts,
            ...recentProcessTurns,
        ];
        const latest = allItems.reduce(
            (max, item) => item.timestamp > max ? item.timestamp : max,
            '',
        );
        const prefixCount = allItems.filter(item => item.prefixMatch).length;

        return {
            exactPrefixMatches,
            recentWorkspacePrompts,
            recentProcessTurns,
            historyFingerprint: `${allItems.length}:${latest}:${prefixCount}`,
        };
    }

    private mapPromptAutocompleteRows(
        rows: PromptAutocompleteHistoryRow[],
        prefix: string,
    ): PromptAutocompleteHistoryItem[] {
        const normalizedPrefix = prefix.toLocaleLowerCase();
        return rows.map(row => ({
            text: row.text,
            source: row.source,
            workspaceId: row.workspaceId || undefined,
            processId: row.processId || undefined,
            timestamp: row.timestamp,
            prefixMatch: normalizedPrefix.length > 0
                ? row.text.toLocaleLowerCase().startsWith(normalizedPrefix)
                : false,
        }));
    }

    /**
     * Recent unique user prompts in a workspace, ordered most-recent first.
     * Powers up/down arrow history navigation in chat inputs.
     *
     * Sources combined:
     *   - Initial process prompts from `processes.full_prompt`
     *   - User-role follow-up turns from `conversation_turns.content`
     *
     * Filters:
     *   - Excludes archived processes and archived/deleted turns.
     *   - Excludes empty/whitespace-only content.
     * Deduplicated by exact text (case-sensitive). The first (most recent)
     * occurrence wins; later duplicates are dropped.
     *
     * Caps `limit` to `[1, 200]`; default 50.
     */
    getRecentUserPrompts(workspaceId: string, opts?: { limit?: number }): string[] {
        if (!workspaceId) return [];
        const requested = opts?.limit ?? 50;
        const limit = Math.max(1, Math.min(200, Math.floor(requested)));

        // Pull more than `limit` so we still have enough after dedup. Use a
        // generous floor (200) so that even with heavy duplication the next
        // distinct prompt is reachable for typical workspaces.
        const fetchLimit = Math.min(Math.max(limit * 5, 200), 1000);

        // Union initial prompts + user follow-up turns, ordered by timestamp DESC.
        const rows = this.db.prepare(`
            SELECT text, ts FROM (
                SELECT
                    full_prompt AS text,
                    start_time  AS ts
                FROM processes
                WHERE workspace_id = @workspaceId
                  AND archived = 0
                  AND full_prompt IS NOT NULL
                  AND length(trim(full_prompt)) > 0
                UNION ALL
                SELECT
                    ct.content   AS text,
                    ct.timestamp AS ts
                FROM conversation_turns ct
                JOIN processes p ON p.id = ct.process_id
                WHERE p.workspace_id = @workspaceId
                  AND p.archived = 0
                  AND ct.role = 'user'
                  AND ct.deleted_at IS NULL
                  AND COALESCE(ct.archived, 0) = 0
                  AND ct.content IS NOT NULL
                  AND length(trim(ct.content)) > 0
            )
            ORDER BY ts DESC
            LIMIT @fetchLimit
        `).all({ workspaceId, fetchLimit }) as Array<{ text: string }>;

        const seen = new Set<string>();
        const result: string[] = [];
        for (const row of rows) {
            if (seen.has(row.text)) continue;
            seen.add(row.text);
            result.push(row.text);
            if (result.length >= limit) break;
        }
        return result;
    }

    // ========================================================================
    // Conversation Turns (lightweight accessor)
    // ========================================================================

    async getConversationTurns(processId: string): Promise<ConversationTurn[]> {
        const turnRows = this.getTurnsStmt.all(processId) as TurnRow[];
        return turnRows.map(rowToTurn);
    }

    // ========================================================================
    // Recent Processes
    // ========================================================================

    async listRecentProcesses(options: {
        workspaceId?: string;
        since?: Date;
        until?: Date;
        limit?: number;
        offset?: number;
        excludeProcessId?: string;
    }): Promise<ProcessIndexEntry[]> {
        const conditions: string[] = ['archived = 0'];
        const params: unknown[] = [];

        if (options.workspaceId) {
            conditions.push('workspace_id = ?');
            params.push(options.workspaceId);
        }

        if (options.excludeProcessId) {
            conditions.push('id != ?');
            params.push(options.excludeProcessId);
        }

        if (options.since) {
            conditions.push('last_event_at >= ?');
            params.push(options.since.toISOString());
        }

        if (options.until) {
            conditions.push('last_event_at < ?');
            params.push(options.until.toISOString());
        }

        const whereSQL = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(Math.max(1, options.limit ?? 10), 100);
        const offset = Math.max(0, options.offset ?? 0);

        const query = `
            SELECT id, workspace_id, status, type, start_time, end_time,
                   prompt_preview, error, parent_process_id, title, custom_title, last_message_preview,
                   last_event_at, pinned_at, archived
            FROM processes ${whereSQL}
            ORDER BY last_event_at DESC
            LIMIT ? OFFSET ?
        `;

        const entries: ProcessIndexEntry[] = [];
        for (const row of this.db.prepare(query).iterate(...params, limit, offset) as IterableIterator<ProcessRow>) {
            const startMs = new Date(row.start_time).getTime();
            const endMs = row.end_time ? new Date(row.end_time).getTime() : undefined;
            entries.push({
                id: row.id,
                workspaceId: row.workspace_id,
                status: row.status,
                type: row.type || 'clarification',
                startTime: new Date(row.start_time).toISOString(),
                endTime: row.end_time ? new Date(row.end_time).toISOString() : undefined,
                promptPreview: row.prompt_preview ?? '',
                error: row.error ?? undefined,
                parentProcessId: row.parent_process_id ?? undefined,
                title: row.title ?? undefined,
                customTitle: row.custom_title ?? undefined,
                lastMessagePreview: row.last_message_preview ?? undefined,
                duration: endMs !== undefined ? endMs - startMs : undefined,
                lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : undefined,
                activityAt: new Date(row.last_event_at ?? row.start_time).toISOString(),
                pinnedAt: row.pinned_at ?? undefined,
                archived: intToBool(row.archived) || undefined,
            });
        }

        return entries;
    }

    // ========================================================================
    // Disposal
    // ========================================================================

    close(): void {
        this.db.close();
    }

    // ========================================================================
    // Private helpers
    // ========================================================================

    private getOrCreateEmitter(id: string): EventEmitter {
        let emitter = this.emitters.get(id);
        if (!emitter) {
            emitter = new EventEmitter();
            this.emitters.set(id, emitter);
        }
        return emitter;
    }

    /** Build a WHERE clause from ProcessFilter fields. */
    private buildProcessWhereClause(
        filter?: ProcessFilter,
        useActivityTime: boolean = false,
    ): { sql: string; params: unknown[] } {
        if (!filter) return { sql: '', params: [] };

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (filter.workspaceId !== undefined) {
            conditions.push('workspace_id = ?');
            params.push(filter.workspaceId);
        }
        if (filter.parentProcessId !== undefined) {
            conditions.push('parent_process_id = ?');
            params.push(filter.parentProcessId);
        }
        if (filter.status !== undefined) {
            if (Array.isArray(filter.status)) {
                conditions.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
                params.push(...filter.status);
            } else {
                conditions.push('status = ?');
                params.push(filter.status);
            }
        }
        if (filter.type !== undefined) {
            conditions.push('type = ?');
            params.push(filter.type);
        }
        const timeExpression = useActivityTime ? 'last_event_at' : 'start_time';
        if (filter.since !== undefined) {
            conditions.push(`${timeExpression} >= ?`);
            params.push(filter.since.toISOString());
        }
        if (filter.until !== undefined) {
            conditions.push(`${timeExpression} < ?`);
            params.push(filter.until.toISOString());
        }

        if (conditions.length === 0) return { sql: '', params: [] };
        return { sql: `WHERE ${conditions.join(' AND ')}`, params };
    }

    /**
     * Apply partial process updates inline within a transaction (no re-read).
     * Used by appendConversationTurn for additionalUpdates.
     */
    private applyProcessUpdatesInline(
        processId: string,
        updates: Partial<Omit<AIProcess, 'conversationTurns'>>,
        existingRow: ProcessRow,
    ): void {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        const mapField = (column: string, value: unknown, transform?: (v: unknown) => unknown) => {
            if (value !== undefined) {
                setClauses.push(`${column} = ?`);
                values.push(transform ? transform(value) : value);
            }
        };

        mapField('type', updates.type);
        mapField('prompt_preview', updates.promptPreview);
        mapField('full_prompt', updates.fullPrompt);
        mapField('status', updates.status);
        mapField('start_time', updates.startTime, v => (v as Date).toISOString());
        mapField('end_time', updates.endTime, v => v ? (v as Date).toISOString() : null);
        mapField('error', updates.error);
        mapField('result', updates.result);
        mapField('result_file_path', updates.resultFilePath);
        mapField('raw_stdout_file_path', updates.rawStdoutFilePath);
        mapField('structured_result', updates.structuredResult);
        mapField('parent_process_id', updates.parentProcessId);
        mapField('sdk_session_id', updates.sdkSessionId);
        mapField('backend', updates.backend);
        mapField('working_directory', updates.workingDirectory);
        mapField('title', updates.title);
        mapField('custom_title', updates.customTitle, v => (v === '' ? null : v));
        mapField('last_message_preview', updates.lastMessagePreview, v => (v === '' ? null : v));
        mapField('token_limit', updates.tokenLimit);
        mapField('current_tokens', updates.currentTokens);
        mapField('system_tokens', updates.systemTokens);
        mapField('tool_definitions_tokens', updates.toolDefinitionsTokens);
        mapField('conversation_tokens', updates.conversationTokens);
        mapField('cumulative_token_usage', updates.cumulativeTokenUsage, v => jsonStringify(v));
        mapField('group_metadata', updates.groupMetadata, v => jsonStringify(v));
        if (updates.stale !== undefined) {
            setClauses.push('stale = ?');
            values.push(boolToInt(updates.stale));
        }
        mapField('data_file_path', updates.dataFilePath);
        mapField('pinned_at', updates.pinnedAt);
        if (updates.archived !== undefined) {
            setClauses.push('archived = ?');
            values.push(boolToInt(updates.archived));
        }

        // Handle metadata envelope if any metadata-related fields are updated
        if ('metadata' in updates || 'codeReviewMetadata' in updates ||
            'discoveryMetadata' in updates || 'codeReviewGroupMetadata' in updates ||
            'pendingMessages' in updates || 'pendingAskUser' in updates ||
            'pendingAskUserAnswer' in updates) {
            const existingEnvelope = jsonParse<MetadataEnvelope>(existingRow.metadata) ?? {};
            const { __codeReviewMetadata, __discoveryMetadata, __codeReviewGroupMetadata, __pendingMessages, __pendingAskUser, __pendingAskUserAnswer, ...existingMeta } = existingEnvelope;

            const newMeta = 'metadata' in updates ? (updates.metadata ?? {}) : existingMeta;
            const newCrm = 'codeReviewMetadata' in updates ? updates.codeReviewMetadata : __codeReviewMetadata;
            const newDm = 'discoveryMetadata' in updates ? updates.discoveryMetadata : __discoveryMetadata;
            const newCrgm = 'codeReviewGroupMetadata' in updates ? updates.codeReviewGroupMetadata : __codeReviewGroupMetadata;
            const newPm = 'pendingMessages' in updates ? updates.pendingMessages : __pendingMessages;
            const newAskUser = 'pendingAskUser' in updates ? updates.pendingAskUser : __pendingAskUser;
            const newAskUserAnswer = 'pendingAskUserAnswer' in updates ? updates.pendingAskUserAnswer : __pendingAskUserAnswer;

            const envelope: MetadataEnvelope = { ...(newMeta as object) };
            if (newCrm) envelope.__codeReviewMetadata = newCrm;
            if (newDm) envelope.__discoveryMetadata = newDm;
            if (newCrgm) envelope.__codeReviewGroupMetadata = newCrgm;
            if (newPm && (newPm as unknown[]).length > 0) envelope.__pendingMessages = newPm;
            if (newAskUser) envelope.__pendingAskUser = newAskUser;
            if (newAskUserAnswer) envelope.__pendingAskUserAnswer = newAskUserAnswer;

            const hasContent = Object.keys(envelope).length > 0;
            setClauses.push('metadata = ?');
            values.push(hasContent ? JSON.stringify(envelope) : null);
        }

        if (setClauses.length === 0) return;

        values.push(processId);
        this.db.prepare(`UPDATE processes SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    }
}
