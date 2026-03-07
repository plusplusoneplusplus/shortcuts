/**
 * Tests for extracted pending-task components:
 *   PendingTaskInfoPanel, PendingTaskPayload, MetaRow, FilePathValue
 *
 * Validates that the components exist as standalone modules with the
 * same structure and exports that QueueTaskDetail previously had inline.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const PENDING_INFO_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'PendingTaskInfoPanel.tsx'
);

const PENDING_PAYLOAD_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'PendingTaskPayload.tsx'
);

const QUEUE_TASK_DETAIL_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'QueueTaskDetail.tsx'
);

describe('PendingTaskInfoPanel (standalone)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(PENDING_INFO_PATH, 'utf-8');
    });

    it('exports PendingTaskInfoPanel as a named export', () => {
        expect(source).toContain('export function PendingTaskInfoPanel');
    });

    it('exports PendingTaskInfoPanelProps interface', () => {
        expect(source).toContain('export interface PendingTaskInfoPanelProps');
    });

    it('accepts task, onCancel, and onMoveToTop props', () => {
        expect(source).toContain('task: any');
        expect(source).toContain('onCancel: () => void');
        expect(source).toContain('onMoveToTop: () => void');
    });

    it('renders pending task name with hourglass icon', () => {
        expect(source).toContain('⏳');
        expect(source).toContain('Pending Task');
    });

    it('renders metadata grid with Task ID, Type, Priority', () => {
        expect(source).toContain('Task ID');
        expect(source).toContain('Type');
        expect(source).toContain('Priority');
    });

    it('renders Cancel Task and Move to Top action buttons', () => {
        expect(source).toContain('Cancel Task');
        expect(source).toContain('Move to Top');
    });

    it('fetches resolved prompt from API', () => {
        expect(source).toContain('/resolved-prompt');
    });

    it('renders resolved prompt details section', () => {
        expect(source).toContain('Full Prompt (Resolved)');
    });

    it('uses PendingTaskPayload for payload rendering', () => {
        expect(source).toContain('<PendingTaskPayload');
    });

    it('uses MetaRow and FilePathValue from PendingTaskPayload module', () => {
        expect(source).toContain("from './PendingTaskPayload'");
        expect(source).toContain('MetaRow');
        expect(source).toContain('FilePathValue');
    });

    it('renders loading state with Spinner', () => {
        expect(source).toContain('Loading task info...');
        expect(source).toContain('Spinner');
    });

    it('uses FilePathValue for Working Directory', () => {
        expect(source).toContain('<FilePathValue label="Working Directory" value={workingDir}');
    });
});

describe('PendingTaskPayload (standalone)', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(PENDING_PAYLOAD_PATH, 'utf-8');
    });

    it('exports PendingTaskPayload as a named export', () => {
        expect(source).toContain('export function PendingTaskPayload');
    });

    it('exports MetaRow as a named export', () => {
        expect(source).toContain('export function MetaRow');
    });

    it('exports FilePathValue as a named export', () => {
        expect(source).toContain('export function FilePathValue');
    });

    it('handles follow-prompt type', () => {
        expect(source).toContain("type === 'follow-prompt'");
    });

    it('handles resolve-comments type', () => {
        expect(source).toContain("type === 'resolve-comments'");
    });

    it('handles chat type', () => {
        expect(source).toContain("type === 'chat'");
    });

    it('handles ai-clarification type', () => {
        expect(source).toContain("type === 'ai-clarification'");
    });

    it('handles task-generation type', () => {
        expect(source).toContain("type === 'task-generation'");
    });

    it('handles code-review type', () => {
        expect(source).toContain("type === 'code-review'");
    });

    it('handles custom type with data', () => {
        expect(source).toContain("type === 'custom'");
    });

    it('fetches images when payload.hasImages is true', () => {
        expect(source).toContain('payload.hasImages');
        expect(source).toContain("fetchApi(`/queue/${encodeURIComponent(task.id)}/images`)");
    });

    it('renders ImageGallery for fetched images', () => {
        expect(source).toContain('<ImageGallery');
    });

    it('uses FilePathLink in FilePathValue', () => {
        expect(source).toContain('<FilePathLink path={value}');
    });

    it('uses FilePathValue for Prompt File', () => {
        expect(source).toContain('<FilePathValue label="Prompt File" value={payload.promptFilePath}');
    });

    it('uses FilePathValue for Plan File', () => {
        expect(source).toContain('<FilePathValue label="Plan File" value={payload.planFilePath}');
    });

    it('uses FilePathValue for file-path fields', () => {
        expect(source).toContain('<FilePathValue label="File" value={payload.filePath}');
        expect(source).toContain('<FilePathValue label="Target Folder" value={payload.targetFolder}');
        expect(source).toContain('<FilePathValue label="Rules Folder" value={payload.rulesFolder}');
    });

    it('clears payloadImages and loading state before the early-return guard', () => {
        const effectStart = source.indexOf('useEffect(() => {');
        const effectBody = source.substring(effectStart, effectStart + 500);
        const clearImagesIdx = effectBody.indexOf('setPayloadImages([])');
        const clearLoadingIdx = effectBody.indexOf('setPayloadImagesLoading(false)');
        const guardIdx = effectBody.indexOf('if (!task?.id || !payload.hasImages');
        expect(clearImagesIdx).toBeGreaterThan(-1);
        expect(clearLoadingIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeGreaterThan(-1);
        expect(clearImagesIdx).toBeLessThan(guardIdx);
        expect(clearLoadingIdx).toBeLessThan(guardIdx);
    });
});

describe('QueueTaskDetail imports extracted components', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(QUEUE_TASK_DETAIL_PATH, 'utf-8');
    });

    it('imports PendingTaskInfoPanel from standalone module', () => {
        expect(source).toContain("import { PendingTaskInfoPanel } from './PendingTaskInfoPanel'");
    });

    it('imports PendingTaskPayload, MetaRow, FilePathValue from standalone module', () => {
        expect(source).toContain("import { PendingTaskPayload, MetaRow, FilePathValue } from './PendingTaskPayload'");
    });

    it('no longer defines PendingTaskInfoPanel inline', () => {
        expect(source).not.toMatch(/^function PendingTaskInfoPanel/m);
    });

    it('no longer defines MetaRow inline', () => {
        expect(source).not.toMatch(/^function MetaRow/m);
    });

    it('no longer defines FilePathValue inline', () => {
        expect(source).not.toMatch(/^function FilePathValue/m);
    });

    it('no longer defines PendingTaskPayload inline', () => {
        expect(source).not.toMatch(/^function PendingTaskPayload/m);
    });

    it('still uses PendingTaskInfoPanel in JSX', () => {
        expect(source).toContain('<PendingTaskInfoPanel');
    });

    it('still exports QueueTaskDetail', () => {
        expect(source).toContain('export function QueueTaskDetail');
    });
});
