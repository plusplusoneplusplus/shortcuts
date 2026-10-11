import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { AIProcess, CreateTaskInput, ProcessStore } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import { z } from 'zod';
import { getRepoDataPath } from '../paths';
import { getRalphContext } from '../tasks/task-types';
import { RalphSessionStore } from './ralph-session-store';
import { RALPH_DEFAULT_MAX_ITERATIONS, readRepoPreferences } from '../preferences-handler';
import { processOperationAdmission } from '../processes/process-operation-admission';
import { normalizeRalphGrillSetupForContext } from './grill-setup';
import { extractGoalSpecFromGrillingResponse } from '../work-items/work-item-executor';

const goalSchema = z.object({ path: z.string(), revision: z.string(), turnIndex: z.number().int() });
const stateSchema = z.object({
    workspaceId: z.string(), sessionId: z.string(), processId: z.string(),
    goal: goalSchema.optional(),
    synthesisTurnIndex: z.number().int().optional(),
    start: z.object({ taskId: z.string(), goalSpec: z.string(), status: z.enum(['admitting', 'admitted', 'rejected']),
        targetKey: z.string().optional(),
        execution: z.object({ workspaceId: z.string(), sessionId: z.string(), processId: z.string(), remote: z.boolean() }).optional() }).optional(),
});
export type RalphGrillingState = z.infer<typeof stateSchema>;
export type RalphGoalReadiness = z.infer<typeof goalSchema>;

/** Separate from the execution journal's completion receipt and iteration state. */
export class RalphGrillingStore {
    constructor(private readonly dataDir: string) {}

    private file(workspaceId: string, sessionId: string): string {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(sessionId)) throw new Error('Invalid Ralph session identity');
        return path.join(new RalphSessionStore({ dataDir: this.dataDir }).getSessionDir(workspaceId, sessionId), 'grilling.json');
    }

    goalPath(workspaceId: string, sessionId: string): string {
        this.file(workspaceId, sessionId);
        return path.resolve(getRepoDataPath(this.dataDir, workspaceId, path.join('notes', 'Plans', `${sessionId}.goal.md`)));
    }

    async read(workspaceId: string, sessionId: string): Promise<RalphGrillingState | undefined> {
        try {
            const state = stateSchema.parse(JSON.parse(await fs.readFile(this.file(workspaceId, sessionId), 'utf8')));
            if (state.workspaceId !== workspaceId || state.sessionId !== sessionId) throw new Error('Ralph grilling owner mismatch');
            return state;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw error;
        }
    }

    async write(state: RalphGrillingState): Promise<void> {
        const file = this.file(state.workspaceId, state.sessionId);
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temp, JSON.stringify(stateSchema.parse(state)), 'utf8');
            await fs.rename(temp, file);
        } finally {
            await fs.rm(temp, { force: true });
        }
    }

    async validatedGoal(state: RalphGrillingState): Promise<string | undefined> {
        if (!state.goal || state.goal.path !== this.goalPath(state.workspaceId, state.sessionId)) return undefined;
        try {
            const text = (await fs.readFile(state.goal.path, 'utf8')).trim();
            return isValidRalphGoal(text) && goalRevision(text) === state.goal.revision ? text : undefined;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw error;
        }
    }
}

export function isValidRalphGoal(text: string): boolean {
    const match = /^## Goal\b[^\r\n]*\r?\n([\s\S]*)$/.exec(text.trim());
    return !!match && !!match[1].split(/^## /m)[0].trim();
}

export function goalRevision(text: string): string {
    return createHash('sha256').update(text.trim()).digest('hex');
}

/** Canonical queue admission, shared by composer and delegated launches. */
export async function prepareRalphGrilling(input: CreateTaskInput, deps: {
    dataDir: string;
    store: Pick<ProcessStore, 'getWorkspaces'>;
    enabled: boolean;
}): Promise<void> {
    const context = (input.payload.context ?? {}) as Record<string, unknown>;
    const initial = getRalphContext(input);
    if (initial?.phase !== 'grilling' || input.payload.processId || context.workItemGoalGrilling) return;
    return processOperationAdmission.runExclusive(`ralph-grill:${input.payload.workspaceId}:${initial.sessionId}`, async () => {
        const ctx = initial;
        if (!deps.enabled) throw new Error('Ralph grilling is disabled (ralph.enabled)');
        if (input.type !== 'chat' || input.payload.mode !== 'ask') throw new Error('Ralph grilling requires Ask mode');
        const workspaceId = input.payload.workspaceId;
        if (typeof workspaceId !== 'string' || !(await deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) {
            throw new Error('Ralph grilling requires a registered local workspace');
        }
        if (!ctx.sessionId || !/^ralph-[a-zA-Z0-9-]+$/.test(ctx.sessionId)) throw new Error('Invalid Ralph session identity');
        input.id ??= randomUUID();
        const processId = toQueueProcessId(input.id);
        const grilling = new RalphGrillingStore(deps.dataDir);
        const prior = await grilling.read(workspaceId, ctx.sessionId);
        if (prior && prior.processId !== processId) throw new Error('Ralph session already belongs to another conversation');
        if (prior?.start) throw new Error('Ralph interview already has a Start approval');
        if (!prior) {
            await new RalphSessionStore({ dataDir: deps.dataDir }).initSession(workspaceId, ctx.sessionId, {
                originalGoal: '', phase: 'grilling',
                maxIterations: readRepoPreferences(deps.dataDir, workspaceId).maxRalphIterations ?? RALPH_DEFAULT_MAX_ITERATIONS,
            });
            await grilling.write({ workspaceId, sessionId: ctx.sessionId, processId });
        }
        input.payload.context = {
            ...context,
            skills: [...new Set([...(Array.isArray(context.skills) ? context.skills.filter((skill): skill is string => typeof skill === 'string') : []), 'grill-me'])],
            ralph: { ...ctx, grill: normalizeRalphGrillSetupForContext(ctx.grill) },
        };
        const directive = `Save the final synthesized ## Goal artifact to this exact path: ${grilling.goalPath(workspaceId, ctx.sessionId).replace(/\\/g, '/')}`;
        if (!String(input.payload.prompt).includes(directive)) input.payload.prompt = `${input.payload.prompt}\n\n${directive}`;
    });
}

/** Persist only a finished synthesis, never an interview turn or pending question. */
export async function reconcileRalphGoal(initialProcess: AIProcess, deps: {
    dataDir: string;
    store: Pick<ProcessStore, 'getProcess' | 'updateProcess'>;
}): Promise<RalphGrillingState | undefined> {
    const ctx = getRalphContext(initialProcess);
    const workspaceId = initialProcess.metadata?.workspaceId;
    if (ctx?.phase !== 'grilling' || !ctx.sessionId || typeof workspaceId !== 'string') return;
    const sessionId = ctx.sessionId;
    return processOperationAdmission.runExclusive(initialProcess.id, async () => {
        const process = await deps.store.getProcess(initialProcess.id, workspaceId);
        if (!process || process.metadata?.workspaceId !== workspaceId || getRalphContext(process)?.sessionId !== sessionId) return;
        const grilling = new RalphGrillingStore(deps.dataDir);
        const state = await grilling.read(workspaceId, sessionId);
        if (!state || state.processId !== process.id || (state.start && state.start.status !== 'rejected')) return state;
        const turns = process.conversationTurns ?? [];
        const lastUser = turns.reduce((index, turn, i) => turn.role === 'user' && !turn.displayOnly ? i : index, -1);
        const final = turns.slice(lastUser + 1).filter(turn => turn.role === 'assistant' && !turn.streaming && !turn.displayOnly).at(-1);
        let text: string | undefined;
        if (process.status === 'completed' && !process.pendingAskUser && final) {
            text = extractGoalSpecFromGrillingResponse(final.content);
            const target = grilling.goalPath(workspaceId, sessionId);
            // A short final reply may refer to a saved synthesis. It must name the
            // server-owned destination in this request, not a source-machine path.
            if (!text && final.content?.replace(/\\/g, '/').includes(target.replace(/\\/g, '/'))) {
                try { text = (await fs.readFile(target, 'utf8')).trim(); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            }
            if (text && !isValidRalphGoal(text)) text = undefined;
        }
        if (text && state.synthesisTurnIndex === final?.turnIndex) {
            // Re-reading history must not silently restore an edited/stale artifact.
            if (!await grilling.validatedGoal(state)) delete state.goal;
        } else if (text) {
            const target = grilling.goalPath(workspaceId, sessionId);
            await fs.mkdir(path.dirname(target), { recursive: true });
            const temp = `${target}.${randomUUID()}.tmp`;
            try { await fs.writeFile(temp, text, 'utf8'); await fs.rename(temp, target); }
            finally { await fs.rm(temp, { force: true }); }
            state.synthesisTurnIndex = final!.turnIndex;
            state.goal = { path: target, revision: goalRevision(text), turnIndex: final!.turnIndex };
        } else {
            delete state.goal;
        }
        await grilling.write(state);
        await deps.store.updateProcess(process.id, { metadata: {
            ...process.metadata, type: process.metadata?.type ?? 'chat', ralphGoal: state.goal ?? null,
            ...(state.goal ? { goalFilePath: state.goal.path } : {}),
        } });
        return state;
    });
}

/** Read-only projection: refresh never creates readiness or restarts a child. */
export async function projectRalphGrillingMetadata(process: AIProcess, dataDir: string): Promise<AIProcess> {
    const ctx = getRalphContext(process);
    const workspaceId = process.metadata?.workspaceId;
    if (ctx?.phase !== 'grilling' || !ctx.sessionId || typeof workspaceId !== 'string') return process;
    const grilling = new RalphGrillingStore(dataDir);
    const state = await grilling.read(workspaceId, ctx.sessionId);
    if (!state || state.processId !== process.id) return process;
    const lastUser = (process.conversationTurns ?? []).filter(turn => turn.role === 'user' && !turn.displayOnly).at(-1);
    const ready = process.status === 'completed' && !process.pendingAskUser && state.goal
        && (lastUser?.turnIndex ?? -1) < state.goal.turnIndex && await grilling.validatedGoal(state);
    const execution = state.start?.status === 'admitted'
        ? state.start.execution ?? { workspaceId, sessionId: ctx.sessionId, processId: toQueueProcessId(state.start.taskId), remote: false }
        : undefined;
    return { ...process, metadata: { ...process.metadata!, ralphGoal: ready ? state.goal : null,
        ...(state.start ? { ralphApprovedGoalSpec: state.start.goalSpec, ralphApprovedTargetKey: state.start.targetKey } : {}),
        ...(ready ? { goalFilePath: state.goal!.path } : {}),
        ...(execution ? { ralphLaunchedSession: { workspaceId: execution.workspaceId, sessionId: execution.sessionId,
            executionProcessId: execution.processId, resultDelivery: execution.remote ? { status: 'unavailable' } : undefined } } : {}),
    } };
}
