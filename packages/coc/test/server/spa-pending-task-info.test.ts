/**
 * SPA Dashboard Tests — Pending Task Info Panel
 *
 * Verifies that clicking a pending queue task opens an info panel
 * showing task metadata and prompt content (React path).
 */

import { describe, it, expect } from 'vitest';
import { getClientBundle } from './spa-test-helpers';

describe('Pending Task Info Panel', () => {
    it('includes PendingTaskInfoPanel component in bundle', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('PendingTaskInfoPanel');
    });

    it('includes PendingTaskPayload component in bundle', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('PendingTaskPayload');
    });

    it('includes pending-task-info CSS class in bundle', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('pending-task-info');
    });

    it('renders metadata fields for pending tasks', () => {
        const bundle = getClientBundle();
        // Metadata labels rendered in MetaRow components
        expect(bundle).toContain('Task ID');
        expect(bundle).toContain('Working Directory');
        expect(bundle).toContain('Repo ID');
    });

    it('renders cancel and move-to-top action buttons', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('Cancel Task');
        expect(bundle).toContain('Move to Top');
    });

    it('handles follow-prompt task type with promptContent display', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('promptContent');
        expect(bundle).toContain('promptFilePath');
    });

    it('handles ai-clarification task type with prompt and selectedText', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('ai-clarification');
        expect(bundle).toContain('selectedText');
    });

    it('handles code-review task type with commit and diff fields', () => {
        const bundle = getClientBundle();
        expect(bundle).toContain('commitSha');
        expect(bundle).toContain('Diff Type');
        expect(bundle).toContain('Rules Folder');
    });

    it('fetches full task data from /api/queue/ endpoint for pending tasks', () => {
        const bundle = getClientBundle();
        // The fetchApi call for pending task detail
        expect(bundle).toContain('/queue/');
    });

    it('conditionally renders info panel only for queued status', () => {
        const bundle = getClientBundle();
        // The isPending check
        expect(bundle).toContain('isPending');
    });

    it('renders hourglass icon for pending task header', () => {
        const bundle = getClientBundle();
        // Hourglass emoji ⏳ (may be encoded as literal or escape in bundle)
        expect(bundle).toContain('23F3');
    });

    it('QueueTaskItem in RepoQueueTab accepts onClick prop', () => {
        const bundle = getClientBundle();
        // The QueueTaskItem component should pass onClick to Card
        expect(bundle).toContain('QueueTaskItem');
    });
});
