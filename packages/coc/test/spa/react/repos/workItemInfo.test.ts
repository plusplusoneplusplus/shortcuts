/**
 * @vitest-environment jsdom
 *
 * Unit tests for the pure work-item copy formatters.
 */
import { describe, it, expect } from 'vitest';
import {
    getWorkItemIdentifier,
    getWorkItemStatusLabel,
    getWorkItemTypeLabel,
    formatWorkItemInfo,
    type WorkItemInfoInput,
} from '../../../../src/server/spa/client/react/features/work-items/workItemInfo';

const PBI: WorkItemInfoInput = {
    id: '4a27276e-9b0c-1111-2222-333344445555',
    workItemNumber: 23,
    title: 'Show project-relative paths in the work item list',
    status: 'planning',
    type: 'pbi',
};

describe('getWorkItemIdentifier', () => {
    it('returns the type-prefixed number for a synced item', () => {
        expect(getWorkItemIdentifier(PBI)).toBe('PBI-23');
    });

    it('falls back to the raw UUID when there is no number', () => {
        expect(getWorkItemIdentifier({ ...PBI, workItemNumber: undefined })).toBe(PBI.id);
    });

    it('defaults to the WI prefix when the type is absent', () => {
        expect(getWorkItemIdentifier({ id: 'u', workItemNumber: 7, title: 't', status: 'created' })).toBe('WI-7');
    });
});

describe('getWorkItemStatusLabel', () => {
    it('maps a known status to a human-readable label', () => {
        expect(getWorkItemStatusLabel({ ...PBI, status: 'readyToExecute' })).toBe('Ready');
    });

    it('falls back to the raw status when unmapped', () => {
        expect(getWorkItemStatusLabel({ ...PBI, status: 'mystery' })).toBe('mystery');
    });
});

describe('getWorkItemTypeLabel', () => {
    it('maps a known type to a human-readable label', () => {
        expect(getWorkItemTypeLabel({ ...PBI, type: 'work-item' })).toBe('Work Item');
    });

    it('defaults to the work-item label when the type is absent', () => {
        expect(getWorkItemTypeLabel({ id: 'u', title: 't', status: 'created' })).toBe('Work Item');
    });
});

describe('formatWorkItemInfo', () => {
    it('includes identifier, title, mapped type + status, and the raw ID', () => {
        const out = formatWorkItemInfo(PBI);
        expect(out).toContain('PBI-23');
        expect(out).toContain('Show project-relative paths in the work item list');
        expect(out).toContain('Type: PBI · Status: Planning');
        expect(out).toContain(`ID: ${PBI.id}`);
    });

    it('omits the description block when description is empty or whitespace', () => {
        const noDesc = formatWorkItemInfo(PBI);
        expect(noDesc.endsWith(`ID: ${PBI.id}`)).toBe(true);
        expect(noDesc).not.toContain('\n\n');

        const blankDesc = formatWorkItemInfo({ ...PBI, description: '   \n  ' });
        expect(blankDesc).not.toContain('\n\n');
    });

    it('appends the description as a trailing block when present', () => {
        const out = formatWorkItemInfo({ ...PBI, description: 'Some details here' });
        expect(out).toContain(`ID: ${PBI.id}\n\nSome details here`);
    });
});
