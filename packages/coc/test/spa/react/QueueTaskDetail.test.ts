/**
 * Tests for QueueTaskDetail component — image paste integration.
 *
 * Validates imports, hook usage, image previews rendering,
 * images included in POST bodies, and image state clearing.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const QUEUE_TASK_DETAIL_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'queue', 'QueueTaskDetail.tsx'
);

describe('QueueTaskDetail', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(QUEUE_TASK_DETAIL_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports QueueTaskDetail as a named export', () => {
            expect(source).toContain('export function QueueTaskDetail');
        });
    });

    describe('image paste integration', () => {
        it('imports useImagePaste hook', () => {
            expect(source).toContain("import { useImagePaste } from '../hooks/useImagePaste'");
        });

        it('imports ImagePreviews component', () => {
            expect(source).toContain("import { ImagePreviews } from '../shared/ImagePreviews'");
        });

        it('destructures useImagePaste result', () => {
            expect(source).toContain('const { images, addFromPaste, removeImage, clearImages } = useImagePaste()');
        });

        it('attaches onPaste to follow-up textarea', () => {
            expect(source).toContain('onPaste={addFromPaste}');
        });

        it('renders ImagePreviews with images and onRemove', () => {
            expect(source).toContain('<ImagePreviews images={images} onRemove={removeImage}');
        });

        it('includes images in sendFollowUp POST body', () => {
            // Find the sendFollowUp function and check images are in the body
            const sendFollowUpSection = source.substring(source.indexOf('const sendFollowUp'));
            expect(sendFollowUpSection).toContain('images: images.length > 0');
            expect(sendFollowUpSection).toContain('? images');
            expect(sendFollowUpSection).toContain(': undefined');
        });

        it('clears images after successful follow-up', () => {
            const sendFollowUpSection = source.substring(source.indexOf('const sendFollowUp'));
            // clearImages() should appear after waitForFollowUpCompletion and before the catch
            const waitIdx = sendFollowUpSection.indexOf('await waitForFollowUpCompletion');
            const clearIdx = sendFollowUpSection.indexOf('clearImages()');
            const catchIdx = sendFollowUpSection.indexOf('} catch');
            expect(waitIdx).toBeGreaterThan(-1);
            expect(clearIdx).toBeGreaterThan(waitIdx);
            expect(clearIdx).toBeLessThan(catchIdx);
        });

        it('clears images when switching tasks', () => {
            // The reset effect includes clearImages()
            const resetEffect = source.substring(
                source.indexOf('Reset follow-up state when switching tasks'),
                source.indexOf('Reset follow-up state when switching tasks') + 500,
            );
            expect(resetEffect).toContain('clearImages()');
        });

        it('sends images as undefined when none are pasted', () => {
            // The body uses a ternary: images.length > 0 ? images : undefined
            const sendFollowUpSection = source.substring(source.indexOf('const sendFollowUp'));
            expect(sendFollowUpSection).toContain(': undefined');
        });
    });

    describe('follow-up send', () => {
        it('POSTs to /processes/:id/message endpoint', () => {
            expect(source).toContain('`${getApiBase()}/processes/${encodeURIComponent(selectedProcessId)}/message`');
        });

        it('sends content in the body', () => {
            expect(source).toContain('content,');
        });

        it('handles Enter key without Shift for send', () => {
            expect(source).toContain("event.key === 'Enter' && !event.shiftKey");
        });
    });

    describe('session expiry (410)', () => {
        it('detects 410 status on follow-up', () => {
            expect(source).toContain('response.status === 410');
        });

        it('sets session expired flag', () => {
            expect(source).toContain('setFollowUpSessionExpired(true)');
        });
    });

    describe('no-session follow-up guard', () => {
        it('computes noSessionForFollowUp from terminal status and missing session', () => {
            expect(source).toContain('noSessionForFollowUp');
            // Must check both terminal status and processDetails loaded
            expect(source).toMatch(/isTerminal\s*&&\s*processDetails\s*!==\s*null\s*&&\s*!resumeSessionId/);
        });

        it('hides chat input when noSessionForFollowUp is true', () => {
            expect(source).toContain('!isPending && !noSessionForFollowUp && (');
        });

        it('shows informational message when follow-up is unavailable', () => {
            expect(source).toContain('!isPending && noSessionForFollowUp && (');
            expect(source).toContain('Follow-up chat is not available for this process type.');
        });

        it('defines isTerminal from completed or failed status', () => {
            expect(source).toMatch(/isTerminal\s*=.*completed.*failed|isTerminal\s*=.*failed.*completed/);
        });
    });

    describe('SSE chunk timeline merging', () => {
        it('merges consecutive content chunks into a single timeline item', () => {
            const chunkHandler = source.substring(
                source.indexOf("es.addEventListener('chunk'"),
                source.indexOf("es.addEventListener('tool-start'"),
            );
            // Should check last timeline item type before appending
            expect(chunkHandler).toContain("lastItem.type === 'content'");
            // Should merge content by concatenation
            expect(chunkHandler).toContain("(lastItem.content || '') + chunk");
            // Should slice off the last item when merging
            expect(chunkHandler).toContain('prev.slice(0, -1)');
        });

        it('creates a new timeline item when last item is not content', () => {
            const chunkHandler = source.substring(
                source.indexOf("es.addEventListener('chunk'"),
                source.indexOf("es.addEventListener('tool-start'"),
            );
            // Fallback: push new content item (for empty timeline or after tool events)
            expect(chunkHandler).toContain("type: 'content' as const");
            expect(chunkHandler).toContain('timestamp: new Date().toISOString()');
        });

        it('tool events always push a new timeline item (merge boundary)', () => {
            const toolHandler = source.substring(
                source.indexOf('const handleToolSSE'),
                source.indexOf("es.addEventListener('tool-start'"),
            );
            // Tool handler spreads unconditionally
            expect(toolHandler).toContain('...(last.timeline || [])');
            expect(toolHandler).toContain('type: eventType');
        });
    });

    describe('lazy image loading', () => {
        it('PendingTaskPayload fetches images when payload.hasImages is true', () => {
            expect(source).toContain('payload.hasImages');
            expect(source).toContain("fetchApi(`/queue/${encodeURIComponent(task.id)}/images`)");
        });

        it('PendingTaskPayload renders ImageGallery for fetched images', () => {
            const pendingPayloadSection = source.substring(source.indexOf('function PendingTaskPayload'));
            expect(pendingPayloadSection).toContain('<ImageGallery');
        });

        it('ConversationTurnBubble receives taskId prop', () => {
            expect(source).toContain('taskId={selectedTaskId}');
        });
    });
});
