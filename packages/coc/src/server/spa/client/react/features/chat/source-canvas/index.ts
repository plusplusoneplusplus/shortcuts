/**
 * Barrel for the docked source-file canvas panel.
 */
export { SourceCanvasPanel } from './SourceCanvasPanel';
export type { SourceCanvasPanelProps } from './SourceCanvasPanel';
export { SourceCanvasDock } from './SourceCanvasDock';
export type { SourceCanvasDockProps } from './SourceCanvasDock';
export { SourceCanvasBody } from './SourceCanvasBody';
export type { SourceCanvasBodyProps } from './SourceCanvasBody';
export { SourceCanvasTreeBody } from './SourceCanvasTreeBody';
export type { SourceCanvasTreeBodyProps } from './SourceCanvasTreeBody';
export { SourceCanvasNoteEditor } from './SourceCanvasNoteEditor';
export type { SourceCanvasNoteEditorProps } from './SourceCanvasNoteEditor';
export { SourceCanvasNotePopOutButton } from './SourceCanvasNotePopOutButton';
export type { SourceCanvasNotePopOutButtonProps } from './SourceCanvasNotePopOutButton';
export { useSourceCanvasState } from './useSourceCanvasState';
export type {
    UseSourceCanvasStateOptions,
    UseSourceCanvasStateReturn,
} from './useSourceCanvasState';
export { useSourceCanvasContent } from './useSourceCanvasContent';
export type {
    SourceCanvasContentState,
    SourceCanvasContentStatus,
} from './useSourceCanvasContent';
export { useSourceCanvasTree } from './useSourceCanvasTree';
export type {
    SourceCanvasTreeState,
    SourceCanvasTreeStatus,
} from './useSourceCanvasTree';
export {
    getSourceCanvasDisplayPath,
    getSourceCanvasWorkspaceRelativePath,
    resolveSourceCanvasTarget,
    isSourceCanvasResolveError,
} from './resolve';
export type {
    SourceCanvasTarget,
    SourceCanvasResolveError,
    SourceCanvasWorkspace,
} from './resolve';
export type { SourceCanvasFileRef } from './types';
export {
    collectConversationSourceFiles,
    getConversationSourceFileKey,
    useConversationSourceFiles,
} from './conversationSourceFiles';
export type { ConversationSourceFile } from './conversationSourceFiles';
