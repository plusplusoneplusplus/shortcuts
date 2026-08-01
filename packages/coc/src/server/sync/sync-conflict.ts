/**
 * Conflict-resolution kernel for the notes sync engine.
 *
 * Steady-state merge-conflict resolution (AI → simple → keep-remote fallback),
 * the fallback audit trail, the resolution commit + durable marker, and the AI
 * prompting / response validation all live here behind
 * {@link SyncConflictResolver} and the exported helpers it uses.
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeReadFileAsync } from '@plusplusoneplusplus/forge';
import type { AIInvoker } from '@plusplusoneplusplus/forge';
import type { SyncGitRepository } from './sync-git';
import type { SyncLogger } from './sync-types';
import {
    resolutionCommitMessage,
    writeResolutionMarker,
} from './sync-reconcile';
import type {
    ResolvedFile,
    ResolutionStrategy,
    SyncResolutionReport,
} from './sync-reconcile';

/**
 * Simple merge-conflict resolution: extracts both sides and concatenates them,
 * preferring to keep all content from both versions.
 */
export function resolveConflictSimple(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inConflict = false;
    let side: 'ours' | 'theirs' = 'ours';
    const ours: string[] = [];
    const theirs: string[] = [];

    for (const line of lines) {
        if (line.startsWith('<<<<<<<')) {
            inConflict = true;
            side = 'ours';
            ours.length = 0;
            theirs.length = 0;
            continue;
        }
        if (line.startsWith('=======') && inConflict) {
            side = 'theirs';
            continue;
        }
        if (line.startsWith('>>>>>>>') && inConflict) {
            // Merge: keep both sides, deduplicate identical lines
            const oursText = ours.join('\n');
            const theirsText = theirs.join('\n');
            if (oursText === theirsText) {
                result.push(oursText);
            } else {
                result.push(oursText);
                if (oursText && theirsText) result.push('');
                result.push(theirsText);
            }
            inConflict = false;
            continue;
        }

        if (inConflict) {
            if (side === 'ours') ours.push(line);
            else theirs.push(line);
        } else {
            result.push(line);
        }
    }

    return result.join('\n');
}

// ── AI conflict resolution prompt ────────────────────────────────────────────

const CONFLICT_RESOLUTION_PROMPT = `You are resolving a Git merge conflict in a personal notes file used in a "My Work / My Life" productivity system.

The file below contains Git conflict markers (<<<<<<< / ======= / >>>>>>>). Each conflict region has two versions:
- "Ours" (between <<<<<<< and =======): changes from this machine
- "Theirs" (between ======= and >>>>>>>): changes from another machine

Your job:
1. Understand the semantic content — these are action items, journal entries, goals, reflections, or follow-ups.
2. Merge intelligently: keep ALL meaningful content from both sides. Do not drop any action items, tasks, or journal entries.
3. If both sides edited the same item (e.g. updated a status or added notes), combine them logically — prefer the more complete or recent version, but preserve any unique details from either side.
4. Remove the conflict markers entirely. Output ONLY the final resolved file content with no markers, no explanations, and no surrounding code fences.

File: {{fileName}}

Content with conflicts:
{{content}}`;

/**
 * Resolve merge conflicts using AI. Sends the conflicted file to the AI invoker
 * and expects back a clean resolved version.
 *
 * @throws if the AI call fails or returns an empty response
 */
export async function resolveConflictWithAI(
    aiInvoker: AIInvoker,
    fileName: string,
    content: string,
): Promise<string> {
    const prompt = CONFLICT_RESOLUTION_PROMPT
        .replace('{{fileName}}', fileName)
        .replace('{{content}}', content);

    const result = await aiInvoker(prompt);

    if (!result.success || !result.response?.trim()) {
        throw new Error(result.error || 'AI returned empty response for conflict resolution');
    }

    let resolved = result.response.trim();

    // Strip code fences if the AI wrapped the output
    if (resolved.startsWith('```')) {
        const lines = resolved.split('\n');
        // Remove first line (```markdown or ```) and last line (```)
        if (lines[lines.length - 1].trim() === '```') {
            lines.shift();
            lines.pop();
            resolved = lines.join('\n');
        }
    }

    // Sanity check: resolved content should not contain conflict markers
    if (resolved.includes('<<<<<<<') || resolved.includes('>>>>>>>')) {
        throw new Error('AI response still contains conflict markers');
    }

    return resolved;
}

/**
 * Resolves merge conflicts for a workspace's sync repo. Prefers the AI resolver,
 * falls back to simple concatenation, and — file by file — records which path
 * each note took so the commit body and status report can enumerate it (the
 * `--theirs` fallback silently drops this device's edit, which is exactly why it
 * is recorded rather than dropped without trace).
 */
export class SyncConflictResolver {
    constructor(
        private readonly git: SyncGitRepository,
        private readonly syncRepoDir: string,
        private readonly logger: SyncLogger,
        private readonly aiInvoker?: AIInvoker,
    ) {}

    /**
     * Resolve every conflicted path left by a pull, commit the resolution, and
     * persist it to a durable marker. Returns the report (for the caller to put
     * on the status), or null when there was nothing to resolve.
     */
    async resolveConflicts(): Promise<SyncResolutionReport | null> {
        const conflictedFiles = await this.git.conflictedFiles();
        if (conflictedFiles.length === 0) return null;

        this.logger.info(`Resolving ${conflictedFiles.length} conflicted file(s)`);

        // Record how each note was resolved as we go, so the commit body and the
        // status report can both enumerate it — the simple path used to be silent,
        // and the `--theirs` fallback silently dropped this device's edit.
        const resolved: ResolvedFile[] = [];
        for (const file of conflictedFiles) {
            const filePath = path.join(this.syncRepoDir, file);
            try {
                const readResult = await safeReadFileAsync(filePath);
                if (!readResult.success) throw readResult.error!;
                const outcome = await this.resolveFileConflict(file, readResult.data!);
                await fs.promises.writeFile(filePath, outcome.content, 'utf8');
                await this.git.add(file);
                resolved.push({ path: file, strategy: outcome.strategy });
            } catch (err) {
                this.logger.error(`Failed to resolve conflict in ${file}: ${err}`);
                // Accept theirs as fallback — this discards the local edit, which
                // is exactly why it is recorded rather than dropped silently.
                try {
                    await this.git.checkoutTheirs(file);
                    resolved.push({ path: file, strategy: 'keptRemoteFallback' });
                } catch { /* last resort: skip */ }
            }
        }

        try {
            await this.git.commit(resolutionCommitMessage(resolved));
            this.logger.info('Committed conflict resolution');
            // Only once the resolution commit has landed do we record it: the
            // report carries that commit's SHA, and a marker beside the reconcile
            // one lets the panel still show what the merge did after a restart.
            if (resolved.length > 0) {
                return await this.recordResolution(resolved);
            }
        } catch {
            // May already be committed
        }
        return null;
    }

    /**
     * Persist the just-committed resolution to a durable marker and return the
     * report. Read back in the engine's `start()`, so it survives a restart the
     * way the reconcile report does.
     */
    private async recordResolution(files: ResolvedFile[]): Promise<SyncResolutionReport> {
        const report: SyncResolutionReport = {
            resolvedAt: new Date().toISOString(),
            files,
            commit: await this.git.headSha(),
        };
        await writeResolutionMarker(this.syncRepoDir, report);
        return report;
    }

    /**
     * Resolve a single file's merge conflicts. Uses AI when available, falls back
     * to simple concatenation-based resolution. Returns the strategy alongside the
     * content so the caller can record which path each note took — the simple path
     * would otherwise leave no trace.
     */
    async resolveFileConflict(
        fileName: string,
        content: string,
    ): Promise<{ content: string; strategy: ResolutionStrategy }> {
        if (!this.aiInvoker) {
            return { content: resolveConflictSimple(content), strategy: 'simple' };
        }

        try {
            const resolved = await resolveConflictWithAI(this.aiInvoker, fileName, content);
            this.logger.info(`AI resolved conflict in ${fileName}`);
            return { content: resolved, strategy: 'ai' };
        } catch (err) {
            this.logger.warn(`AI conflict resolution failed for ${fileName}, falling back to simple merge: ${err}`);
            return { content: resolveConflictSimple(content), strategy: 'simple' };
        }
    }
}
