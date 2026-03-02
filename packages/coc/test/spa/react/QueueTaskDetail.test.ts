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

    describe('scroll-to-bottom button positioning', () => {
        it('button is outside the scrollable conversation container', () => {
            // The button should be a sibling of #queue-task-conversation, not a child
            const scrollDivStart = source.indexOf('id="queue-task-conversation"');
            const scrollDivTag = source.lastIndexOf('<div', scrollDivStart);
            // Find the closing </div> of the scrollable container
            // The button must appear AFTER the scrollable div closes
            const buttonIdx = source.indexOf('id="scroll-to-bottom-btn"');
            // Find the </div> that closes #queue-task-conversation before the button
            const closingDivBeforeButton = source.lastIndexOf('</div>', buttonIdx);
            expect(closingDivBeforeButton).toBeGreaterThan(scrollDivStart);
        });

        it('scrollable container does not have relative class', () => {
            const scrollDivIdx = source.indexOf('id="queue-task-conversation"');
            // Extract just the opening tag of the scrollable div (from '<div' to '>')
            const tagStart = source.lastIndexOf('<div', scrollDivIdx);
            const tagEnd = source.indexOf('>', scrollDivIdx);
            const scrollDivTag = source.substring(tagStart, tagEnd + 1);
            // The scroll div should NOT have 'relative' — it was moved to the wrapper
            expect(scrollDivTag).not.toContain('relative');
        });

        it('wrapper div around conversation and button has relative positioning', () => {
            // The parent wrapper of #queue-task-conversation should have 'relative flex-1 min-h-0'
            const scrollDivIdx = source.indexOf('id="queue-task-conversation"');
            const precedingChunk = source.substring(scrollDivIdx - 300, scrollDivIdx);
            // Find the wrapper div that contains 'relative flex-1 min-h-0' before the scroll div
            expect(precedingChunk).toContain('className="relative flex-1 min-h-0"');
        });

        it('button uses absolute positioning', () => {
            const buttonIdx = source.indexOf('id="scroll-to-bottom-btn"');
            const buttonSection = source.substring(buttonIdx, buttonIdx + 300);
            expect(buttonSection).toContain('absolute bottom-4 right-4');
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

        it('clears payloadImages and loading state before the early-return guard', () => {
            // The useEffect in PendingTaskPayload must reset state before the guard
            const pendingPayloadSection = source.substring(source.indexOf('function PendingTaskPayload'));
            const effectStart = pendingPayloadSection.indexOf('useEffect(() => {');
            const effectBody = pendingPayloadSection.substring(effectStart, effectStart + 500);
            const clearImagesIdx = effectBody.indexOf('setPayloadImages([])');
            const clearLoadingIdx = effectBody.indexOf('setPayloadImagesLoading(false)');
            const guardIdx = effectBody.indexOf('if (!task?.id || !payload.hasImages');
            expect(clearImagesIdx).toBeGreaterThan(-1);
            expect(clearLoadingIdx).toBeGreaterThan(-1);
            expect(guardIdx).toBeGreaterThan(-1);
            // Both resets must come before the early-return guard
            expect(clearImagesIdx).toBeLessThan(guardIdx);
            expect(clearLoadingIdx).toBeLessThan(guardIdx);
        });
    });

    describe('hoverable file paths', () => {
        it('imports FilePathLink from shared', () => {
            expect(source).toContain('FilePathLink');
        });

        it('defines FilePathValue component', () => {
            expect(source).toContain('function FilePathValue(');
        });

        it('FilePathValue uses shared FilePathLink component', () => {
            const filePathValueSection = source.substring(source.indexOf('function FilePathValue'));
            expect(filePathValueSection).toContain('<FilePathLink path={value}');
        });

        it('uses FilePathValue for Working Directory', () => {
            expect(source).toContain('<FilePathValue label="Working Directory" value={workingDir}');
        });

        it('uses FilePathValue for Prompt File', () => {
            expect(source).toContain('<FilePathValue label="Prompt File" value={payload.promptFilePath}');
        });

        it('uses FilePathValue for Plan File', () => {
            expect(source).toContain('<FilePathValue label="Plan File" value={payload.planFilePath}');
        });

        it('uses FilePathValue for metadata file path fields', () => {
            expect(source).toContain('<FilePathValue label="File" value={payload.filePath}');
            expect(source).toContain('<FilePathValue label="Target Folder" value={payload.targetFolder}');
            expect(source).toContain('<FilePathValue label="Rules Folder" value={payload.rulesFolder}');
        });

        it('does not use MetaRow for file-path fields', () => {
            expect(source).not.toContain('MetaRow label="Working Directory"');
            expect(source).not.toContain('MetaRow label="Prompt File"');
            expect(source).not.toContain('MetaRow label="Plan File"');
        });
    });
});
