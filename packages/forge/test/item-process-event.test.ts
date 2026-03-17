/**
 * ItemProcessEventData Type Tests
 *
 * Compile-time + runtime shape tests for the ItemProcessEventData interface
 * and its integration with ProcessOutputEvent.
 */

import { describe, it, expect } from 'vitest';
import type { ItemProcessEventData, ProcessOutputEvent } from '../src/index';

describe('ItemProcessEventData', () => {
    it('should construct with required fields', () => {
        const data: ItemProcessEventData = {
            itemIndex: 0,
            processId: 'proc-1-m0',
            status: 'running',
            phase: 'map',
        };
        expect(data.itemIndex).toBe(0);
        expect(data.processId).toBe('proc-1-m0');
        expect(data.status).toBe('running');
        expect(data.phase).toBe('map');
        expect(data.itemLabel).toBeUndefined();
        expect(data.error).toBeUndefined();
    });

    it('should accept optional itemLabel', () => {
        const data: ItemProcessEventData = {
            itemIndex: 3,
            processId: 'proc-1-m3',
            status: 'completed',
            phase: 'map',
            itemLabel: 'Alice',
        };
        expect(data.itemLabel).toBe('Alice');
    });

    it('should accept optional error for failed status', () => {
        const data: ItemProcessEventData = {
            itemIndex: 2,
            processId: 'proc-1-m2',
            status: 'failed',
            phase: 'map',
            error: 'AI timeout',
        };
        expect(data.status).toBe('failed');
        expect(data.error).toBe('AI timeout');
    });

    it('should accept cancelled status', () => {
        const data: ItemProcessEventData = {
            itemIndex: 1,
            processId: 'proc-1-m1',
            status: 'cancelled',
            phase: 'map',
        };
        expect(data.status).toBe('cancelled');
    });

    it('should accept all pipeline phases', () => {
        for (const phase of ['input', 'filter', 'map', 'reduce', 'job'] as const) {
            const data: ItemProcessEventData = {
                itemIndex: 0,
                processId: `proc-${phase}`,
                status: 'running',
                phase,
            };
            expect(data.phase).toBe(phase);
        }
    });
});

describe('ProcessOutputEvent with item-process type', () => {
    it('should accept item-process type with itemProcess data', () => {
        const event: ProcessOutputEvent = {
            type: 'item-process',
            itemProcess: {
                itemIndex: 5,
                processId: 'proc-1-m5',
                status: 'running',
                phase: 'map',
            },
        };
        expect(event.type).toBe('item-process');
        expect(event.itemProcess).toBeDefined();
        expect(event.itemProcess!.itemIndex).toBe(5);
    });

    it('should allow item-process alongside other optional fields', () => {
        const event: ProcessOutputEvent = {
            type: 'item-process',
            itemProcess: {
                itemIndex: 0,
                processId: 'proc-1-m0',
                status: 'completed',
                phase: 'map',
                itemLabel: 'first-item',
            },
        };
        expect(event.itemProcess!.itemLabel).toBe('first-item');
        expect(event.content).toBeUndefined();
        expect(event.pipelinePhase).toBeUndefined();
        expect(event.pipelineProgress).toBeUndefined();
    });
});
