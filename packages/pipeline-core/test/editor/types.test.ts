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
    CommentStatus,
    CommentType,
    CommentSelection,
    CommentAnchor,
    MermaidContext,
    MarkdownComment,
    isUserComment,
    CommentsSettings,
    CommentsConfig,
    DEFAULT_COMMENTS_SETTINGS,
    DEFAULT_COMMENTS_CONFIG,
    WebviewToBackendMessage,
    BackendToWebviewMessage,
    EditorMessage,
    PendingSelection,
    AskAIContext,
    WebviewSettings,
    LineChange,
    SkillInfo,
    RecentPrompt,
    RecentItem,
    AIModelOption,
    FollowPromptDialogOptions,
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
        it('discriminated union covers all 34 variants', () => {
            const variants: WebviewToBackendMessage['type'][] = [
                'ready',
                'requestState',
                'addComment',
                'editComment',
                'deleteComment',
                'resolveComment',
                'reopenComment',
                'resolveAll',
                'deleteAll',
                'updateContent',
                'generatePrompt',
                'copyPrompt',
                'sendToChat',
                'sendCommentToChat',
                'sendToCLIInteractive',
                'sendToCLIBackground',
                'resolveImagePath',
                'openFile',
                'askAI',
                'askAIInteractive',
                'askAIQueued',
                'collapsedSectionsChanged',
                'requestPromptFiles',
                'requestSkills',
                'executeWorkPlan',
                'executeWorkPlanWithSkill',
                'promptSearch',
                'showFollowPromptDialog',
                'followPromptDialogResult',
                'copyFollowPrompt',
                'updateDocument',
                'requestUpdateDocumentDialog',
                'requestRefreshPlanDialog',
                'refreshPlan',
            ];
            expect(variants).toHaveLength(34);
        });

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
        it('discriminated union covers all 8 variants', () => {
            const variants: BackendToWebviewMessage['type'][] = [
                'update',
                'imageResolved',
                'scrollToComment',
                'promptFilesResponse',
                'skillsResponse',
                'showFollowPromptDialog',
                'showUpdateDocumentDialog',
                'showRefreshPlanDialog',
            ];
            expect(variants).toHaveLength(8);
        });

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
    // EditorMessage convenience alias
    // -----------------------------------------------------------------
    describe('EditorMessage', () => {
        it('accepts both webview-to-backend and backend-to-webview', () => {
            const w2b: EditorMessage = { type: 'ready' };
            const b2w: EditorMessage = { type: 'showRefreshPlanDialog' };
            expect(w2b.type).toBe('ready');
            expect(b2w.type).toBe('showRefreshPlanDialog');
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

    // -----------------------------------------------------------------
    // Supporting message types shape validation
    // -----------------------------------------------------------------
    describe('Supporting types', () => {
        it('PendingSelection extends CommentSelection', () => {
            const ps: PendingSelection = {
                startLine: 1,
                startColumn: 1,
                endLine: 2,
                endColumn: 5,
                selectedText: 'text',
            };
            // PendingSelection is assignable to CommentSelection
            const cs: CommentSelection = ps;
            expect(cs.startLine).toBe(1);
        });

        it('LineChange has expected shape', () => {
            const lc: LineChange = { line: 5, type: 'added' };
            expect(lc.line).toBe(5);
            const lc2: LineChange = { line: 10, type: 'modified' };
            expect(lc2.type).toBe('modified');
        });

        it('AskAIContext has expected shape', () => {
            const ctx: AskAIContext = {
                selectedText: 'code',
                startLine: 1,
                endLine: 5,
                surroundingLines: 'before\ncode\nafter',
                nearestHeading: '## Section',
                allHeadings: ['# Title', '## Section'],
                instructionType: 'clarify',
                mode: 'comment',
            };
            expect(ctx.mode).toBe('comment');
        });

        it('SkillInfo has expected shape (no sourceFolder)', () => {
            const si: SkillInfo = {
                absolutePath: '/a/b',
                relativePath: 'b',
                name: 'my-skill',
                description: 'A skill',
            };
            expect(si.name).toBe('my-skill');
            // Ensure sourceFolder is NOT required
            expect((si as Record<string, unknown>)['sourceFolder']).toBeUndefined();
        });

        it('RecentItem and RecentPrompt have expected shapes', () => {
            const rp: RecentPrompt = {
                absolutePath: '/a/b.prompt.md',
                relativePath: 'b.prompt.md',
                name: 'b',
                lastUsed: Date.now(),
            };
            expect(rp.name).toBe('b');

            const ri: RecentItem = {
                type: 'skill',
                identifier: 'my-skill',
                name: 'My Skill',
                lastUsed: Date.now(),
            };
            expect(ri.type).toBe('skill');
        });

        it('AIModelOption has expected shape', () => {
            const opt: AIModelOption = { id: 'gpt-4', label: 'GPT-4', isDefault: true };
            expect(opt.isDefault).toBe(true);
        });

        it('FollowPromptDialogOptions has expected shape', () => {
            const opts: FollowPromptDialogOptions = {
                mode: 'background',
                model: 'gpt-4',
                additionalContext: 'some context',
            };
            expect(opts.mode).toBe('background');
        });

        it('WebviewSettings has expected shape', () => {
            const ws: WebviewSettings = {
                showResolved: true,
                askAIEnabled: true,
                collapsedSections: ['heading-1'],
            };
            expect(ws.showResolved).toBe(true);
        });
    });
});
