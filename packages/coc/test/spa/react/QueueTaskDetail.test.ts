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
});
