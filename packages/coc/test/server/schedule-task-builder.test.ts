/**
 * Fixture tests for schedule queue payload construction.
 *
 * These pin the exact payload shapes the executor enqueues for prompt (ask
 * and autopilot), Ralph, and script schedules, so extracting or changing the
 * builders cannot silently alter what reaches the queue.
 */

import { describe, it, expect } from 'vitest';
import {
    buildSchedulePrompt,
    buildSchedulePromptTask,
    buildScheduleRalphTask,
    buildScheduleScriptTask,
    resolveScheduleExecutionKind,
    resolveScheduleOutputFolder,
} from '../../src/server/schedule/schedule-task-builder';
import type { ScheduleEntry, ScheduleRunRecord } from '../../src/server/schedule/schedule-manager-types';

const REPO_ID = 'ws-test';

function makeSchedule(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
    return {
        id: 'sch_abc',
        name: 'Nightly',
        target: 'nightly.md',
        cron: '0 2 * * *',
        params: {},
        onFailure: 'notify',
        status: 'active',
        createdAt: '2026-03-01T00:00:00Z',
        ...overrides,
    };
}

function makeRun(): ScheduleRunRecord {
    return {
        id: 'run_abc',
        scheduleId: 'sch_abc',
        repoId: REPO_ID,
        startedAt: '2026-03-01T02:00:00Z',
        status: 'running',
    };
}

function ctx(schedule: ScheduleEntry, defaultModel?: string) {
    return { repoId: REPO_ID, schedule, run: makeRun(), defaultModel };
}

describe('resolveScheduleExecutionKind', () => {
    it('treats a missing targetType as prompt', () => {
        expect(resolveScheduleExecutionKind(makeSchedule())).toBe('prompt');
    });

    it('routes mode: ralph to the Ralph builder', () => {
        expect(resolveScheduleExecutionKind(makeSchedule({ mode: 'ralph' }))).toBe('ralph');
    });

    it('routes targetType: script to the script builder', () => {
        expect(resolveScheduleExecutionKind(makeSchedule({ targetType: 'script' }))).toBe('script');
    });

    it('ignores mode: ralph on a script schedule', () => {
        expect(resolveScheduleExecutionKind(makeSchedule({ targetType: 'script', mode: 'ralph' }))).toBe('script');
    });

    it('returns undefined for an unknown target type', () => {
        expect(resolveScheduleExecutionKind(makeSchedule({ targetType: 'pipeline' as never }))).toBeUndefined();
    });
});

describe('output folder and prompt', () => {
    it('defaults the output folder to the workspace task dir', () => {
        expect(resolveScheduleOutputFolder(REPO_ID, makeSchedule()))
            .toBe(`~/.coc/repos/${REPO_ID}/tasks`);
    });

    it('prefers an explicit output folder', () => {
        expect(resolveScheduleOutputFolder(REPO_ID, makeSchedule({ outputFolder: '/tmp/out' })))
            .toBe('/tmp/out');
    });

    it('prefixes the instruction with the output folder', () => {
        expect(buildSchedulePrompt(REPO_ID, makeSchedule()))
            .toBe(`Output folder: ~/.coc/repos/${REPO_ID}/tasks\n\nFollow the instruction nightly.md.`);
    });
});

describe('buildSchedulePromptTask', () => {
    it('builds the autopilot chat payload', () => {
        expect(buildSchedulePromptTask(ctx(makeSchedule()))).toEqual({
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: `Output folder: ~/.coc/repos/${REPO_ID}/tasks\n\nFollow the instruction nightly.md.`,
                provider: undefined,
                context: {
                    files: ['nightly.md'],
                    scheduleId: 'sch_abc',
                    scheduleParams: {},
                },
                workingDirectory: '',
            },
            config: { model: undefined },
            displayName: '[Schedule] Nightly',
            repoId: REPO_ID,
        });
    });

    it('carries ask mode, provider, and the resolved model through', () => {
        const task = buildSchedulePromptTask(
            ctx(makeSchedule({ mode: 'ask', provider: 'claude' }), 'claude-opus-5'),
        );
        expect(task.payload).toMatchObject({ mode: 'ask', provider: 'claude' });
        expect(task.config).toEqual({ model: 'claude-opus-5' });
    });

    it('defaults an unset mode to autopilot', () => {
        expect(buildSchedulePromptTask(ctx(makeSchedule({ mode: undefined }))).payload)
            .toMatchObject({ mode: 'autopilot' });
    });
});

describe('buildScheduleRalphTask', () => {
    it('threads the session, goal, and schedule context into the iteration task', () => {
        const task = buildScheduleRalphTask(
            ctx(makeSchedule({ mode: 'ralph', params: { flavor: 'gap-loop' } }), 'claude-opus-5'),
            { sessionId: 'ralph-1', originalGoal: 'do the thing', maxIterations: 7 },
        );

        expect(task.displayName).toBe('[Schedule:Ralph] Nightly');
        expect(task.config).toEqual({ model: 'claude-opus-5' });
        const context = (task.payload as any).context;
        expect(context.ralph).toMatchObject({
            sessionId: 'ralph-1',
            originalGoal: 'do the thing',
            phase: 'executing',
            maxIterations: 7,
        });
        expect(context.scheduleId).toBe('sch_abc');
        expect(context.scheduleRunId).toBe('run_abc');
        expect(context.scheduleParams).toEqual({ flavor: 'gap-loop' });
    });
});

describe('buildScheduleScriptTask', () => {
    it('builds the run-script payload with an empty working directory by default', () => {
        expect(buildScheduleScriptTask(ctx(makeSchedule({ targetType: 'script', target: 'build.sh' }))))
            .toEqual({
                type: 'run-script',
                priority: 'normal',
                payload: {
                    kind: 'run-script',
                    script: 'build.sh',
                    workingDirectory: '',
                    scheduleId: 'sch_abc',
                },
                config: {},
                displayName: '[Schedule:script] Nightly',
                repoId: REPO_ID,
            });
    });

    it('uses params.workingDirectory when provided', () => {
        const task = buildScheduleScriptTask(ctx(makeSchedule({
            targetType: 'script',
            params: { workingDirectory: '/srv/app' },
        })));
        expect((task.payload as any).workingDirectory).toBe('/srv/app');
    });
});
