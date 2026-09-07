/**
 * Audit trail for the dangerous-command guard (AC-08).
 *
 * A guard decision is only useful if it survives the turn: "why did the agent
 * not run that command" is a question people ask after the fact. Each decision
 * is appended to the chat process's metadata, so it is readable from the
 * process record long after the prompt scrolled away.
 *
 * The records name the rule and the decision only. The command text is
 * deliberately absent — it can carry secrets, and unlike the approval prompt
 * (which is transient and shown to the person who typed it) this is persisted.
 */

import type { GenericProcessMetadata, ProcessStore } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { DangerousCommandDecisionRecord } from './dangerous-command-guard-wiring';

/** Metadata key holding the per-process audit trail. */
export const DANGEROUS_COMMAND_AUDIT_METADATA_KEY = 'dangerousCommandGuard';

/** How many decisions one process keeps. Old ones fall off the front. */
export const DANGEROUS_COMMAND_AUDIT_LIMIT = 100;

/** The metadata block this module writes. */
export interface DangerousCommandAuditMetadata {
    decisions: DangerousCommandDecisionRecord[];
}

/**
 * Per-process write chain.
 *
 * Appending is read-modify-write against the store, so two decisions landing in
 * the same tick would otherwise race and drop one. Serializing per process is
 * enough: nothing else in the codebase writes this key.
 */
const writeChains = new Map<string, Promise<void>>();

/** Read the audit trail off a metadata blob, tolerating a missing/odd shape. */
export function readDangerousCommandAudit(
    metadata: GenericProcessMetadata | undefined,
): DangerousCommandDecisionRecord[] {
    const block = metadata?.[DANGEROUS_COMMAND_AUDIT_METADATA_KEY] as
        | DangerousCommandAuditMetadata
        | undefined;
    return Array.isArray(block?.decisions) ? block.decisions : [];
}

/**
 * Append one decision to a process's audit trail.
 *
 * Fire-and-forget by design — the guard's answer to the model must not wait on
 * a database write, and a failed audit write must not fail the turn. The
 * returned promise is there for tests.
 */
export function recordDangerousCommandDecision(
    store: Pick<ProcessStore, 'getProcess' | 'updateProcess'>,
    processId: string,
    record: DangerousCommandDecisionRecord,
    taskType = 'chat',
): Promise<void> {
    const previous = writeChains.get(processId) ?? Promise.resolve();
    const next = previous
        .catch(() => undefined)
        .then(async () => {
            const proc = await store.getProcess(processId);
            if (!proc) return;
            const decisions = [...readDangerousCommandAudit(proc.metadata), record].slice(
                -DANGEROUS_COMMAND_AUDIT_LIMIT,
            );
            const metadata: GenericProcessMetadata = {
                type: proc.metadata?.type ?? taskType,
                ...(proc.metadata ?? {}),
                [DANGEROUS_COMMAND_AUDIT_METADATA_KEY]: { decisions },
            };
            await store.updateProcess(processId, { metadata });
        })
        .catch((err) => {
            getLogger().debug(
                LogCategory.AI,
                `[DangerousCommandAudit] Failed to persist decision for ${processId}: ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
        })
        .finally(() => {
            if (writeChains.get(processId) === next) writeChains.delete(processId);
        });
    writeChains.set(processId, next);
    return next;
}
