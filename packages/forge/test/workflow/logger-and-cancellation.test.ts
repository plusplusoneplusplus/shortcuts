import { afterEach, describe, expect, it } from 'vitest';
import * as cocRoot from '@plusplusoneplusplus/coc-workflow';
import * as workflowPackage from '@plusplusoneplusplus/coc-workflow/workflow';
import * as forgeRoot from '../../src';
import * as forgeWorkflow from '../../src/workflow';

// The workflow implementation lives entirely in coc-workflow. These tests pin the two
// cross-package runtime contracts that the consolidation must preserve:
//   1. Configuring the logger through Forge controls the canonical workflow logger.
//   2. Workflow cancellation/error identities are the canonical (coc-workflow) ones.

describe('cross-package logger state', () => {
    afterEach(() => {
        forgeRoot.resetLogger();
    });

    it('setting the logger through Forge controls the canonical workflow logger', () => {
        const seen: string[] = [];
        const sink = {
            debug: (_c: string, m: string) => seen.push(`debug:${m}`),
            info: (_c: string, m: string) => seen.push(`info:${m}`),
            warn: (_c: string, m: string) => seen.push(`warn:${m}`),
            error: (_c: string, m: string) => seen.push(`error:${m}`),
        };

        forgeRoot.setLogger(sink);

        // coc-workflow's global logger (used by the canonical executor) is now Forge's sink.
        expect(cocRoot.getLogger()).toBe(sink);
        cocRoot.getLogger().info('Test', 'hello');
        expect(seen).toContain('info:hello');
    });

    it('resetting the logger through Forge resets the canonical workflow logger', () => {
        const sink = forgeRoot.nullLogger;
        forgeRoot.setLogger(sink);
        expect(cocRoot.getLogger()).toBe(sink);

        forgeRoot.resetLogger();
        expect(cocRoot.getLogger()).not.toBe(sink);
        expect(cocRoot.getLogger()).toBe(cocRoot.consoleLogger);
    });
});

describe('workflow cancellation and error identity', () => {
    it('exposes the canonical WorkflowCancellationError class', () => {
        expect(forgeWorkflow.WorkflowCancellationError).toBe(workflowPackage.WorkflowCancellationError);
        expect(forgeWorkflow.CancellationError).toBe(workflowPackage.CancellationError);
    });

    it('a Forge-surfaced WorkflowCancellationError carries canonical identity', () => {
        const err = new forgeWorkflow.WorkflowCancellationError();
        expect(err).toBeInstanceOf(Error);
        // The canonical cancellation predicate recognises the Forge-surfaced error.
        expect(workflowPackage.isWorkflowCancellationError(err)).toBe(true);
    });

    it('cancellation guards throw the canonical WorkflowCancellationError', () => {
        const controller = new AbortController();
        controller.abort();
        expect(forgeWorkflow.isWorkflowCancelled(controller.signal)).toBe(true);
        expect(() => forgeWorkflow.throwIfWorkflowCancelled(controller.signal)).toThrow(
            workflowPackage.WorkflowCancellationError,
        );
    });

    it('workflow cancellation identity is distinct from Forge runtime cancellation', () => {
        // Forge keeps its own runtime concurrency/cancellation utilities for map-reduce and the
        // task queue; those are a separate class identity from the canonical workflow package.
        expect(forgeRoot.CancellationError).not.toBe(workflowPackage.CancellationError);
        expect(forgeRoot.ConcurrencyLimiter).not.toBe(workflowPackage.ConcurrencyLimiter);
    });
});
