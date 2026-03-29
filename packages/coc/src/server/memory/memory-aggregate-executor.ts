/**
 * Memory Aggregate Executor
 *
 * Task executor for memory consolidation via the queue system.
 * Creates its own process lifecycle: creates AIProcess, streams output,
 * calls AI consolidation, writes result, and completes the process.
 *
 * Includes an in-memory concurrency guard to prevent double-execution
 * for the same repo even if the queue dispatches two tasks.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, QueuedTask, TaskExecutionResult } from '@plusplusoneplusplus/forge';
import { FileMemoryStore as PipelineMemoryStore } from '@plusplusoneplusplus/forge';
import { createCLIAIInvoker } from '../../ai-invoker';
import type { MemoryAggregatePayload } from '../task-types';
import { readMemoryConfig } from './memory-config-handler';
import { FileMemoryStore } from './memory-store';
import { getRepoDataPath } from '../paths';
import { computeDiff } from './repo-memory-handler';

const inProgress = new Set<string>();

function getNoteStore(dataDir: string, workspaceId: string): FileMemoryStore {
    const noteDir = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'notes'));
    return new FileMemoryStore(noteDir);
}

function getPipelineStore(dataDir: string, workspaceId: string): PipelineMemoryStore {
    const config = readMemoryConfig(dataDir);
    const repoDir = getRepoDataPath(dataDir, workspaceId, path.join('memory', 'pipeline'));
    return new PipelineMemoryStore({ dataDir: config.storageDir, repoDir });
}

function consolidatedPrevPath(dataDir: string, workspaceId: string): string {
    return path.join(getRepoDataPath(dataDir, workspaceId, path.join('memory', 'pipeline')), 'consolidated.prev.md');
}

export class MemoryAggregateExecutor {
    constructor(
        private readonly store: ProcessStore,
        private readonly dataDir: string,
    ) {}

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const payload = task.payload as unknown as MemoryAggregatePayload;
        const { repoId, sources, model } = payload;
        const processId = `queue_${task.id}`;

        if (inProgress.has(repoId)) {
            return { success: false, error: new Error('Consolidation already in progress for this repo'), durationMs: 0 };
        }
        inProgress.add(repoId);
        const startMs = Date.now();

        try {
            // Create process for SSE streaming
            await this.store.addProcess({
                id: processId,
                type: 'prompt',
                status: 'running',
                promptPreview: 'Memory consolidation',
                fullPrompt: `Consolidate memory for repo ${repoId}`,
                startTime: new Date(),
                conversationTurns: [],
            });

            this.store.emitProcessOutput(processId, 'Loading memory data…\n');

            const pipelineStore = getPipelineStore(this.dataDir, repoId);

            // Load observations
            let observations: Array<{ pipeline: string; content: string }> = [];
            let observationFilenames: string[] = [];
            if (sources.includes('observations')) {
                observationFilenames = await pipelineStore.listRaw('repo', undefined);
                const rawObs = await Promise.all(
                    observationFilenames.map(f => pipelineStore.readRaw('repo', undefined, f)),
                );
                observations = rawObs
                    .filter((o): o is NonNullable<typeof o> => o !== undefined)
                    .map(o => ({ pipeline: o.metadata.pipeline, content: o.content }));
            }

            // Load user notes
            let notes: Array<{ content: string; tags: string[] }> = [];
            if (sources.includes('notes')) {
                const noteStore = getNoteStore(this.dataDir, repoId);
                const { entries } = noteStore.list({ pageSize: 10000 });
                notes = entries
                    .map(e => ({ content: noteStore.get(e.id)?.content ?? '', tags: e.tags }))
                    .filter(n => n.content !== '');
            }

            if (observations.length === 0 && notes.length === 0) {
                const durationMs = Date.now() - startMs;
                const resultPayload = { diff: '', consolidated: '' };
                await this.store.updateProcess(processId, {
                    status: 'completed',
                    endTime: new Date(),
                    result: JSON.stringify(resultPayload),
                });
                this.store.emitProcessComplete(processId, 'completed', `${durationMs}ms`);
                return { success: true, result: resultPayload, durationMs };
            }

            // Read existing consolidated and save backup
            const previous = await pipelineStore.readConsolidated('repo');
            if (previous !== null) {
                const prevPath = consolidatedPrevPath(this.dataDir, repoId);
                fs.mkdirSync(path.dirname(prevPath), { recursive: true });
                fs.writeFileSync(prevPath, previous, 'utf-8');
            }

            // Build prompt
            const promptParts: string[] = [];
            if (previous) {
                promptParts.push('## Existing Memory\n' + previous);
            }
            if (notes.length > 0) {
                const noteLines = notes
                    .map(n => `- ${n.content}${n.tags.length > 0 ? ` [tags: ${n.tags.join(', ')}]` : ''}`)
                    .join('\n');
                promptParts.push('## User Notes (authoritative — always preserve unless explicitly contradicted)\n' + noteLines);
            }
            if (observations.length > 0) {
                const obsLines = observations.map(o => `- ${o.pipeline}: ${o.content}`).join('\n');
                promptParts.push('## AI Observations\n' + obsLines);
            }
            promptParts.push(
                '## Instructions\n' +
                'Produce an updated memory document. Output ONLY the document itself — no preamble, no commentary.\n' +
                'Start your response directly with the first markdown section header.\n\n' +
                'Write the document in the primary language used in the observations.\n' +
                'Do not translate or alter code, file paths, identifiers, or error messages.\n\n' +
                '### Required Sections (use these exact headings, in this order)\n' +
                '## Conventions\n' +
                '## Architecture\n' +
                '## Patterns & Tools\n' +
                '## Gotchas\n' +
                '## Pending Decisions\n\n' +
                '### Identifier Preservation\n' +
                'Preserve all opaque identifiers exactly as written (no shortening or reconstruction),\n' +
                'including UUIDs, hashes, IDs, tokens, hostnames, IPs, ports, URLs, and file names.\n\n' +
                '### Consolidation Rules\n' +
                '- Deduplicate: merge similar or redundant facts into a single bullet\n' +
                '- Resolve conflicts: user notes override AI observations; newer observations override older ones\n' +
                '- Prune: drop facts that appear no longer relevant or were superseded\n' +
                '- Keep it concise: target <100 facts total\n' +
                '- Each fact must be a bullet point (`- `) under a section header\n' +
                '- If a section has no facts, write "None." under it\n' +
                '- Do not omit unresolved questions or pending decisions',
            );

            const prompt = promptParts.join('\n\n');

            this.store.emitProcessOutput(processId, 'Running AI consolidation…\n');

            const aiInvoker = createCLIAIInvoker({ approvePermissions: true });
            const result = await aiInvoker(prompt, { model });

            if (!result.success) {
                const durationMs = Date.now() - startMs;
                const errorMsg = result.error ?? 'AI call failed';
                await this.store.updateProcess(processId, {
                    status: 'failed',
                    endTime: new Date(),
                    error: errorMsg,
                });
                this.store.emitProcessComplete(processId, 'failed', `${durationMs}ms`);
                return { success: false, error: new Error(errorMsg), durationMs };
            }

            const newConsolidated = result.response ?? '';

            // Write new consolidated.md
            await pipelineStore.writeConsolidated('repo', newConsolidated);
            await pipelineStore.updateIndex('repo', undefined, {
                lastAggregation: new Date().toISOString(),
            });

            // Delete raw observations now that they are consolidated
            for (const filename of observationFilenames) {
                await pipelineStore.deleteRaw('repo', undefined, filename);
            }

            // Compute diff
            const diffLines = computeDiff(previous ?? '', newConsolidated);
            const diffText = diffLines
                .map(l => (l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ') + l.text)
                .join('\n');

            const durationMs = Date.now() - startMs;
            const resultPayload = { diff: diffText, consolidated: newConsolidated };

            this.store.emitProcessOutput(processId, newConsolidated);
            await this.store.updateProcess(processId, {
                status: 'completed',
                endTime: new Date(),
                result: JSON.stringify(resultPayload),
            });
            this.store.emitProcessComplete(processId, 'completed', `${durationMs}ms`);

            return { success: true, result: resultPayload, durationMs };
        } catch (err) {
            const durationMs = Date.now() - startMs;
            const errorMsg = err instanceof Error ? err.message : String(err);
            try {
                await this.store.updateProcess(processId, {
                    status: 'failed',
                    endTime: new Date(),
                    error: errorMsg,
                });
                this.store.emitProcessComplete(processId, 'failed', `${durationMs}ms`);
            } catch { /* non-fatal */ }
            return { success: false, error: err instanceof Error ? err : new Error(errorMsg), durationMs };
        } finally {
            inProgress.delete(repoId);
        }
    }
}
