/**
 * Pipeline UI Module
 *
 * VSCode UI components for the Pipelines Viewer panel.
 * Cross-platform compatible (Linux/Mac/Windows).
 * Supports both bundled (read-only) and workspace (editable) pipelines.
 */

export * from './types';
export * from './pipeline-manager';
export * from './pipeline-item';
export { PipelineCategoryItem } from './pipeline-item';
export * from './tree-data-provider';
export * from './commands';
export * from './pipeline-executor-service';
export * from './preview-mermaid';
export * from './preview-content';
export { registerPipelinePreview, PipelinePreviewEditorProvider } from './preview-provider';

// Result Viewer (enhanced pipeline result display with individual nodes)
export * from './result-viewer-types';
export { getResultViewerContent, getItemDetailContent } from './result-viewer-content';
export {
    PipelineResultViewerProvider,
    registerPipelineResultViewer,
    PIPELINE_RESULTS_EXPORT_SCHEME
} from './result-viewer-provider';

// Bundled Pipelines
export {
    BUNDLED_PIPELINES,
    getBundledPipelinesPath,
    getBundledPipelineManifest,
    getAllBundledPipelineManifests,
    isValidBundledPipelineId,
    getBundledPipelineDirectory,
    getBundledPipelineEntryPoint
} from '../bundled';
