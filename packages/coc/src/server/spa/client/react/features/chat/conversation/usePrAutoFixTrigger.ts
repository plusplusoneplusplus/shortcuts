/**
 * usePrAutoFixTrigger — per-PR data layer for the composer's CI auto-fix controls
 * (AC-05). Owns the arm/disarm lifecycle of a `ci-failure` condition-monitor
 * trigger bound to one PR + the originating conversation, plus the one-shot
 * "Fix now" message.
 *
 * Every call routes through the workspace-scoped client ({@link useCocClient}),
 * so a conversation owned by a REMOTE clone arms its monitor and sends its fix on
 * the server that actually owns that workspace (AC-06) — never a raw page-origin
 * `fetchApi`.
 *
 * The hook is inert (and disabled-with-reason) until the chip wires auto-fix AND
 * the full PR/conversation context (workspaceId, processId, originId, prId) is
 * resolvable, so the composer can render a disabled control with a tooltip rather
 * than a half-wired one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Trigger } from '@plusplusoneplusplus/coc-client';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import type { CiFixCheck } from './prAutoFixPrompt';

export interface PrAutoFixTriggerContext {
    /** Whether the chip wires auto-fix controls (gates all behaviour). */
    enabled: boolean;
    /** Owning workspace id — scopes the trigger + routes to the clone. */
    workspaceId?: string;
    /** Conversation (process) the fix message targets. */
    processId?: string;
    /** Canonical origin id of the PR. */
    originId?: string;
    /** PR id (number as a string). */
    prId?: string;
    /** PR number, for the fix-prompt heading. */
    prNumber: number | string;
}

export interface UsePrAutoFixTriggerResult {
    /** True only when wired AND all PR/conversation context is resolvable. */
    available: boolean;
    /** Whether a `ci-failure` monitor is currently armed for this PR. */
    armed: boolean;
    ciOnly: boolean;
    repairInFlight: boolean;
    status: string | null;
    upgrade: () => Promise<void>;
    /** A network op (list/arm/disarm/fix) is in flight. */
    busy: boolean;
    /**
     * Non-null when the controls should be rendered but disabled — carries the
     * tooltip text. Null when the controls are fully usable.
     */
    disabledReason: string | null;
    /** Last error from an arm/disarm/fix call, surfaced for diagnostics. */
    error: string | null;
    /** Arm a `ci-failure` monitor for this PR + conversation. */
    arm: () => Promise<void>;
    /** Disarm (delete) the armed monitor, if any. */
    disarm: () => Promise<void>;
    /** Send one fix message immediately (no monitor). */
    fixNow: (failingChecks: readonly CiFixCheck[]) => Promise<void>;
}

/** A trigger is the monitor for this PR when it's an active ci-failure event matching origin/pr/process. */
function matchesPr(
    trigger: Trigger,
    originId: string,
    prId: string,
    processId: string,
): boolean {
    if (trigger.status !== 'active' && trigger.status !== 'paused') return false;
    const event = trigger.event;
    if (!event || event.type !== 'condition-monitor' || event.monitor !== 'ci-failure') return false;
    if (event.originId !== originId || event.prId !== prId) return false;
    return trigger.action?.processId === processId;
}

export function usePrAutoFixTrigger(ctx: PrAutoFixTriggerContext): UsePrAutoFixTriggerResult {
    const { enabled, workspaceId, processId, originId, prId } = ctx;

    const [monitor, setMonitor] = useState<Trigger | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const mountedRef = useRef(true);
    const operationRef = useRef(false);
    const readVersionRef = useRef(0);
    const scope = JSON.stringify([workspaceId, processId, originId, prId]);
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    const isCurrent = () => mountedRef.current && scopeRef.current === scope;
    const armedTriggerId = monitor?.status === 'active' ? monitor.id : null;

    const available = Boolean(enabled && workspaceId && processId && originId && prId);

    const fetchArmed = useCallback(() => {
        if (!available || !workspaceId || !processId || !originId || !prId) {
            setMonitor(null);
            return;
        }
        if (operationRef.current) return;
        const version = ++readVersionRef.current;
        getCocClientForWorkspace(workspaceId)
            .triggers.list(workspaceId)
            .then(triggers => {
                if (!isCurrent() || readVersionRef.current !== version) return;
                const found = triggers.find(t => matchesPr(t, originId, prId, processId));
                setMonitor(found ?? null);
                setError(null);
            })
            .catch(err => {
                if (isCurrent() && readVersionRef.current === version) setError(getSpaCocClientErrorMessage(err, 'Unable to read PR auto-fix status.'));
            });
    }, [available, workspaceId, processId, originId, prId]);

    useEffect(() => {
        mountedRef.current = true;
        setMonitor(null);
        setError(null);
        fetchArmed();
        const timer = available ? window.setInterval(fetchArmed, 10_000) : undefined;
        return () => {
            mountedRef.current = false;
            if (timer !== undefined) window.clearInterval(timer);
        };
    }, [fetchArmed]);

    const arm = useCallback(async () => {
        if (!available || !workspaceId || !processId || !originId || !prId) return;
        if (operationRef.current) return;
        operationRef.current = true;
        readVersionRef.current += 1;
        setBusy(true);
        setError(null);
        try {
            const created = await getCocClientForWorkspace(workspaceId).triggers.create(workspaceId, {
                processId,
                event: { type: 'condition-monitor', monitor: 'ci-failure', originId, prId, repairScope: 'ci-and-conflicts' },
            });
            if (isCurrent()) setMonitor(created);
        } catch (err) {
            if (isCurrent()) setError(getSpaCocClientErrorMessage(err, 'Failed to arm PR auto-fix.'));
        } finally {
            operationRef.current = false;
            if (mountedRef.current) setBusy(false);
        }
    }, [available, workspaceId, processId, originId, prId]);

    const disarm = useCallback(async () => {
        if (!available || !workspaceId || !armedTriggerId) return;
        if (operationRef.current) return;
        operationRef.current = true;
        readVersionRef.current += 1;
        setBusy(true);
        setError(null);
        try {
            await getCocClientForWorkspace(workspaceId).triggers.delete(workspaceId, armedTriggerId);
            if (isCurrent()) setMonitor(null);
        } catch (err) {
            if (isCurrent()) setError(getSpaCocClientErrorMessage(err, 'Failed to disarm CI auto-fix.'));
        } finally {
            operationRef.current = false;
            if (mountedRef.current) setBusy(false);
        }
    }, [available, workspaceId, armedTriggerId]);

    const fixNow = useCallback(
        async (_failingChecks: readonly CiFixCheck[]) => {
            if (!available || !workspaceId || !processId || !originId || !prId) return;
            if (operationRef.current) return;
            operationRef.current = true;
            readVersionRef.current += 1;
            setBusy(true);
            setError(null);
            try {
                const repaired = await getCocClientForWorkspace(workspaceId).triggers.repairCi(workspaceId, {
                    processId, event: { type: 'condition-monitor', monitor: 'ci-failure', originId, prId, repairScope: 'ci' },
                });
                if (isCurrent()) setMonitor(repaired);
            } catch (err) {
                if (isCurrent()) setError(getSpaCocClientErrorMessage(err, 'Failed to send fix message.'));
            } finally {
                operationRef.current = false;
                if (mountedRef.current) setBusy(false);
            }
        },
        [available, workspaceId, processId, originId, prId],
    );

    const disabledReason = !available
        ? 'Auto-fix needs a resolved pull request and conversation.'
        : busy
            ? 'Working…'
            : null;

    return {
        available,
        armed: armedTriggerId !== null,
        ciOnly: Boolean(armedTriggerId && monitor?.event.monitor === 'ci-failure' && monitor.event.repairScope !== 'ci-and-conflicts'),
        repairInFlight: Boolean(monitor?.inFlight),
        status: error ?? (monitor?.event.monitor === 'ci-failure' ? monitor.event.repairStatus ?? null : null),
        upgrade: arm,
        busy,
        disabledReason,
        error,
        arm,
        disarm,
        fixNow,
    };
}
