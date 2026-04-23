/**
 * Tests for the refresh button spinning behavior during mutations.
 *
 * Validates that:
 * - The ↺ button spins during handleAdmit (Schedule Immediately)
 * - The ↺ button spins when isTaskSubmitting is true (EnqueueDialog submission)
 * - The ↺ button is static when no mutations are in flight
 * - isRefreshing still shows the Button loading spinner (no regression)
 * - Button is disabled only during isRefreshing, not during other mutations
 * - EnqueueDialog dispatches SET_TASK_SUBMITTING via QueueContext
 * - QueueContext exposes isTaskSubmitting in state
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ACTIVITY_LIST_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat', 'ChatListPane.tsx'
);
const ENQUEUE_DIALOG_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'EnqueueDialog.tsx'
);
const QUEUE_CONTEXT_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'contexts', 'QueueContext.tsx'
);
const REPO_ACTIVITY_TAB_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'chat', 'RepoChatTab.tsx'
);

describe('Refresh button spin during mutations', () => {
    let activityListSource: string;
    let enqueueDialogSource: string;
    let queueContextSource: string;
    let RepoChatTabSource: string;

    beforeAll(() => {
        activityListSource = fs.readFileSync(ACTIVITY_LIST_PATH, 'utf-8');
        enqueueDialogSource = fs.readFileSync(ENQUEUE_DIALOG_PATH, 'utf-8');
        queueContextSource = fs.readFileSync(QUEUE_CONTEXT_PATH, 'utf-8');
        RepoChatTabSource = fs.readFileSync(REPO_ACTIVITY_TAB_PATH, 'utf-8');
    });

    // ── handleAdmit loading state ──────────────────────────────────

    describe('handleAdmit (Schedule Immediately) loading state', () => {
        it('declares isAdmitting state', () => {
            expect(activityListSource).toContain('isAdmitting');
            expect(activityListSource).toContain('setIsAdmitting');
        });

        it('sets isAdmitting to true before the admit fetch', () => {
            const handleAdmitMatch = activityListSource.match(/handleAdmit[\s\S]*?setIsAdmitting\(true\)/);
            expect(handleAdmitMatch).not.toBeNull();
        });

        it('resets isAdmitting in a finally block', () => {
            // Extract the handleAdmit function body
            const admitBlock = activityListSource.match(/handleAdmit[\s\S]*?finally[\s\S]*?setIsAdmitting\(false\)/);
            expect(admitBlock).not.toBeNull();
        });

        it('awaits both the admit POST and fetchQueue before clearing isAdmitting', () => {
            const admitBlock = activityListSource.match(/handleAdmit[\s\S]*?await fetch[\s\S]*?await fetchQueue/);
            expect(admitBlock).not.toBeNull();
        });
    });

    // ── isTaskSubmitting via QueueContext ───────────────────────────

    describe('isTaskSubmitting via QueueContext', () => {
        it('QueueContext state includes isTaskSubmitting', () => {
            expect(queueContextSource).toContain('isTaskSubmitting');
        });

        it('QueueContext supports SET_TASK_SUBMITTING action', () => {
            expect(queueContextSource).toContain('SET_TASK_SUBMITTING');
        });

        it('initial isTaskSubmitting is false', () => {
            expect(queueContextSource).toContain('isTaskSubmitting: false');
        });

        it('ChatListPane reads isTaskSubmitting from QueueContext', () => {
            expect(activityListSource).toContain('useQueue');
            expect(activityListSource).toContain('isTaskSubmitting');
        });
    });

    // ── EnqueueDialog dispatches SET_TASK_SUBMITTING ───────────────

    describe('EnqueueDialog dispatches SET_TASK_SUBMITTING', () => {
        it('dispatches SET_TASK_SUBMITTING true when submitting', () => {
            expect(enqueueDialogSource).toContain("SET_TASK_SUBMITTING");
            expect(enqueueDialogSource).toContain("value: true");
        });

        it('dispatches SET_TASK_SUBMITTING false in finally block', () => {
            const finallyBlock = enqueueDialogSource.match(/finally\s*\{[\s\S]*?SET_TASK_SUBMITTING[\s\S]*?value:\s*false/);
            expect(finallyBlock).not.toBeNull();
        });
    });

    // ── Refresh button JSX ─────────────────────────────────────────

    describe('refresh button rendering', () => {
        it('wraps ↺ in a span element', () => {
            expect(activityListSource).toContain('<span');
            expect(activityListSource).toContain('↺');
        });

        it('applies animate-spin class when isAdmitting or isTaskSubmitting is true', () => {
            expect(activityListSource).toMatch(/isAdmitting\s*\|\|\s*isTaskSubmitting/);
            expect(activityListSource).toContain('animate-spin');
        });

        it('uses inline-block class on the span so CSS transform applies', () => {
            expect(activityListSource).toContain('inline-block');
        });

        it('only shows ↺ span when not isRefreshing (loading spinner takes over)', () => {
            expect(activityListSource).toContain('!isRefreshing');
        });

        it('button is disabled only during isRefreshing', () => {
            // The refresh Button uses disabled={isRefreshing} and onClick={onRefresh}
            // Verify these are on the same Button (within ~200 chars of each other)
            const refreshBtnIdx = activityListSource.indexOf('onClick={onRefresh}');
            expect(refreshBtnIdx).toBeGreaterThan(-1);
            // Look backwards ~200 chars to find the disabled prop on this Button
            const nearbySource = activityListSource.slice(Math.max(0, refreshBtnIdx - 200), refreshBtnIdx + 200);
            expect(nearbySource).toContain('disabled={isRefreshing}');
            expect(nearbySource).not.toContain('disabled={isAdmitting');
            expect(nearbySource).not.toContain('disabled={isTaskSubmitting');
        });
    });

    // ── No regression: manual refresh ──────────────────────────────

    describe('manual refresh (no regression)', () => {
        it('RepoChatTab still has isRefreshing state', () => {
            expect(RepoChatTabSource).toContain('isRefreshing');
            expect(RepoChatTabSource).toContain('setIsRefreshing');
        });

        it('RepoChatTab passes isRefreshing to ChatListPane', () => {
            expect(RepoChatTabSource).toContain('isRefreshing={isRefreshing}');
        });

        it('button loading prop uses isRefreshing', () => {
            expect(activityListSource).toContain('loading={isRefreshing}');
        });
    });
});
