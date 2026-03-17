import { GitLogService } from '../git';
import { AIInvoker } from '../ai/types';
import { PipelineCoreError, ErrorCode } from '../errors';
import { ReplicateOptions, ReplicateResult } from './types';
import { buildReplicatePrompt } from './prompt-builder';
import { parseReplicateResponse } from './result-parser';

export type ReplicateProgressCallback = (stage: string, detail?: string) => void;

export async function replicateCommit(
    options: ReplicateOptions,
    aiInvoker: AIInvoker,
    onProgress?: ReplicateProgressCallback,
): Promise<ReplicateResult> {
    const gitLog = new GitLogService();
    try {
        // 1. Read commit metadata
        onProgress?.('git', 'Reading commit metadata…');
        const commit = gitLog.getCommit(options.repoRoot, options.template.commitHash);
        if (!commit) {
            throw new PipelineCoreError(
                `Template commit not found: ${options.template.commitHash}`,
                { code: ErrorCode.PIPELINE_INPUT_INVALID },
            );
        }

        // 2. Read commit diff
        onProgress?.('git', 'Reading commit diff…');
        const diff = gitLog.getCommitDiff(options.repoRoot, options.template.commitHash);

        // 3. Read changed files
        onProgress?.('git', 'Reading changed files…');
        const files = gitLog.getCommitFiles(options.repoRoot, options.template.commitHash);

        // Dispose git service (clears caches)
        gitLog.dispose();

        // 4. Build prompt
        onProgress?.('prompt', 'Building prompt…');
        const prompt = buildReplicatePrompt(
            { hash: commit.hash, shortHash: commit.shortHash, subject: commit.subject },
            diff,
            files,
            options.instruction,
            options.template.hints,
        );

        // 5. Invoke AI
        onProgress?.('ai', 'Invoking AI…');
        const result = await aiInvoker(prompt);
        if (!result.success) {
            throw new PipelineCoreError(
                `AI invocation failed: ${result.error ?? 'unknown error'}`,
                { code: ErrorCode.AI_INVOCATION_FAILED },
            );
        }

        // 6. Parse response
        onProgress?.('parse', 'Parsing response…');
        const parsed = parseReplicateResponse(result.response!);

        return { files: parsed.files, summary: parsed.summary };
    } catch (err) {
        if (err instanceof PipelineCoreError) {
            throw err;
        }
        throw new PipelineCoreError(
            `Commit replication failed: ${err instanceof Error ? err.message : String(err)}`,
            { code: ErrorCode.UNKNOWN, cause: err },
        );
    }
}
