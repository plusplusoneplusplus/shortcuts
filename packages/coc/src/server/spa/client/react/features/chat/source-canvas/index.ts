/**
 * Barrel for the docked source-file canvas panel.
 */
export { SourceCanvasPanel } from './SourceCanvasPanel';
export type { SourceCanvasPanelProps } from './SourceCanvasPanel';
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
export {
    resolveSourceCanvasTarget,
    isSourceCanvasResolveError,
} from './resolve';
export type {
    SourceCanvasTarget,
    SourceCanvasResolveError,
    SourceCanvasWorkspace,
} from './resolve';
export type { SourceCanvasFileRef } from './types';
