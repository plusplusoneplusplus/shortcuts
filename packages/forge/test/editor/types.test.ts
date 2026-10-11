/**
 * Type compilation tests for editor domain types and message unions.
 *
 * These tests verify that:
 *  1. WebviewToBackendMessage discriminated union is exhaustive (34 variants)
 *  2. BackendToWebviewMessage discriminated union is exhaustive (8 variants)
 *  3. MarkdownComment satisfies the expected shape
 *  4. DEFAULT_COMMENTS_CONFIG has correct defaults
 */

import { describe, it, expect } from 'vitest';
import {
    CommentType,
    CommentAnchor,
    MermaidContext,
    MarkdownComment,
    isUserComment,
    DEFAULT_COMMENTS_SETTINGS,
    DEFAULT_COMMENTS_CONFIG,
    WebviewToBackendMessage,
    BackendToWebviewMessage,
} from '../../src/editor';

// -------------------------------------------------------------------------
// Exhaustiveness helper: if all cases are handled, `msg` is `never`
// -------------------------------------------------------------------------
function assertNever(_value: never): never {
    throw new Error('Unexpected value');
}

describe('Editor types', () => {

    // -----------------------------------------------------------------
    // WebviewToBackendMessage exhaustiveness
    // -----------------------------------------------------------------
    describe('WebviewToBackendMessage', () => {
        it('exhaustive switch compiles over all 34 type values', () => {
            // This function must compile. If a variant is added to the union
            // but not handled, TypeScript will report a type error on the
            // `assertNever` call.
            function handle(msg: WebviewToBackendMessage): string {
                switch (msg.type) {
                    case 'ready': return 'ready';
                    case 'requestState': return 'requestState';
                    case 'addComment': return msg.comment;
                    case 'editComment': return msg.commentId;
                    case 'deleteComment': return msg.commentId;
                    case 'resolveComment': return msg.commentId;
                    case 'reopenComment': return msg.commentId;
                    case 'resolveAll': return 'resolveAll';
                    case 'deleteAll': return 'deleteAll';
                    case 'updateContent': return msg.content;
                    case 'generatePrompt': return msg.promptOptions.format;
                    case 'copyPrompt': return msg.promptOptions.format;
                    case 'sendToChat': return msg.promptOptions.format;
                    case 'sendCommentToChat': return msg.commentId;
                    case 'sendToCLIInteractive': return msg.promptOptions.format;
                    case 'sendToCLIBackground': return msg.promptOptions.format;
                    case 'resolveImagePath': return msg.imgId;
                    case 'openFile': return msg.path;
                    case 'askAI': return msg.context.selectedText;
                    case 'askAIInteractive': return msg.context.selectedText;
                    case 'askAIQueued': return msg.context.selectedText;
                    case 'collapsedSectionsChanged': return msg.collapsedSections.join(',');
                    case 'requestPromptFiles': return 'requestPromptFiles';
                    case 'requestSkills': return 'requestSkills';
                    case 'executeWorkPlan': return msg.promptFilePath;
                    case 'executeWorkPlanWithSkill': return msg.skillName;
                    case 'promptSearch': return 'promptSearch';
                    case 'showFollowPromptDialog': return msg.promptFilePath;
                    case 'followPromptDialogResult': return msg.promptFilePath;
                    case 'copyFollowPrompt': return msg.promptFilePath;
                    case 'updateDocument': return msg.instruction;
                    case 'requestUpdateDocumentDialog': return 'requestUpdateDocumentDialog';
                    case 'requestRefreshPlanDialog': return 'requestRefreshPlanDialog';
                    case 'refreshPlan': return 'refreshPlan';
                    default: return assertNever(msg);
                }
            }

            // Sanity-check that the function is callable
            const msg: WebviewToBackendMessage = { type: 'ready' };
            expect(handle(msg)).toBe('ready');
        });
    });

    // -----------------------------------------------------------------
    // BackendToWebviewMessage exhaustiveness
    // -----------------------------------------------------------------
    describe('BackendToWebviewMessage', () => {
        it('exhaustive switch compiles over all 8 type values', () => {
            function handle(msg: BackendToWebviewMessage): string {
                switch (msg.type) {
                    case 'update': return msg.content;
                    case 'imageResolved': return msg.imgId;
                    case 'scrollToComment': return msg.commentId;
                    case 'promptFilesResponse': return String(msg.promptFiles.length);
                    case 'skillsResponse': return String(msg.skills.length);
                    case 'showFollowPromptDialog': return msg.promptName;
                    case 'showUpdateDocumentDialog': return 'showUpdateDocumentDialog';
                    case 'showRefreshPlanDialog': return 'showRefreshPlanDialog';
                    default: return assertNever(msg);
                }
            }

            const msg: BackendToWebviewMessage = { type: 'showUpdateDocumentDialog' };
            expect(handle(msg)).toBe('showUpdateDocumentDialog');
        });
    });

    // -----------------------------------------------------------------
    // MarkdownComment shape
    // -----------------------------------------------------------------
    describe('MarkdownComment', () => {
        it('accepts a fully populated literal', () => {
            const comment: MarkdownComment = {
                id: 'c1',
                filePath: 'README.md',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
                selectedText: 'hello',
                comment: 'Fix this',
                status: 'open',
                type: 'user',
                createdAt: '2025-01-01T00:00:00Z',
                updatedAt: '2025-01-01T00:00:00Z',
                author: 'dev',
                tags: ['bug'],
                mermaidContext: {
                    diagramId: 'd1',
                    nodeId: 'n1',
                    nodeLabel: 'Node 1',
                    diagramType: 'flowchart',
                    elementType: 'node',
                },
                anchor: {
                    selectedText: 'hello',
                    contextBefore: 'say ',
                    contextAfter: ' world',
                    originalLine: 1,
                    textHash: 'abc123',
                },
            };
            expect(comment.id).toBe('c1');
            expect(comment.status).toBe('open');
        });

        it('accepts a minimal literal (optional fields omitted)', () => {
            const comment: MarkdownComment = {
                id: 'c2',
                filePath: 'doc.md',
                selection: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 20 },
                selectedText: 'some text',
                comment: 'Note',
                status: 'resolved',
                createdAt: '2025-06-01T00:00:00Z',
                updatedAt: '2025-06-01T00:00:00Z',
            };
            expect(comment.type).toBeUndefined();
            expect(comment.anchor).toBeUndefined();
        });
    });

    // -----------------------------------------------------------------
    // isUserComment
    // -----------------------------------------------------------------
    describe('isUserComment', () => {
        it('returns true when type is undefined', () => {
            const c = { type: undefined } as unknown as MarkdownComment;
            expect(isUserComment(c)).toBe(true);
        });

        it('returns true when type is "user"', () => {
            const c = { type: 'user' } as MarkdownComment;
            expect(isUserComment(c)).toBe(true);
        });

        it('returns false for ai types', () => {
            const types: CommentType[] = ['ai-suggestion', 'ai-clarification', 'ai-critique', 'ai-question'];
            for (const t of types) {
                expect(isUserComment({ type: t } as MarkdownComment)).toBe(false);
            }
        });
    });

    // -----------------------------------------------------------------
    // DEFAULT_COMMENTS_CONFIG
    // -----------------------------------------------------------------
    describe('DEFAULT_COMMENTS_CONFIG', () => {
        it('has version 1', () => {
            expect(DEFAULT_COMMENTS_CONFIG.version).toBe(1);
        });

        it('has empty comments array', () => {
            expect(DEFAULT_COMMENTS_CONFIG.comments).toEqual([]);
        });

        it('includes default settings', () => {
            expect(DEFAULT_COMMENTS_CONFIG.settings).toBeDefined();
            expect(DEFAULT_COMMENTS_CONFIG.settings).toEqual(DEFAULT_COMMENTS_SETTINGS);
        });

        it('default settings has showResolved true', () => {
            expect(DEFAULT_COMMENTS_SETTINGS.showResolved).toBe(true);
        });

        it('default settings has all highlight colors defined', () => {
            expect(DEFAULT_COMMENTS_SETTINGS.highlightColor).toBeTruthy();
            expect(DEFAULT_COMMENTS_SETTINGS.resolvedHighlightColor).toBeTruthy();
            expect(DEFAULT_COMMENTS_SETTINGS.aiSuggestionHighlightColor).toBeTruthy();
            expect(DEFAULT_COMMENTS_SETTINGS.aiClarificationHighlightColor).toBeTruthy();
            expect(DEFAULT_COMMENTS_SETTINGS.aiCritiqueHighlightColor).toBeTruthy();
            expect(DEFAULT_COMMENTS_SETTINGS.aiQuestionHighlightColor).toBeTruthy();
        });
    });

});
