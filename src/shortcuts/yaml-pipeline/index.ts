/**
 * YAML Pipeline Framework
 *
 * A YAML-based configuration layer on top of the map-reduce framework.
 * Provides easy configuration for AI MapReduce workflows via YAML files.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 *
 * NOTE: Core pipeline functionality is provided by the @plusplusoneplusplus/pipeline-core package.
 * This module exports VS Code-specific UI components only.
 * Import core types directly from '@plusplusoneplusplus/pipeline-core'.
 */

// UI Components for Pipelines Viewer
export {
    PipelineManager,
    PipelinesTreeDataProvider,
    PipelineItem,
    ResourceItem,
    PipelineCommands,
    registerPipelineResultsProvider,
    PIPELINE_RESULTS_SCHEME,
    registerPipelinePreview,
    PipelinePreviewEditorProvider
} from './ui';

export type {
    PipelineTreeItem
} from './ui';

export { PipelineCategoryItem } from './ui';

export type {
    PipelineInfo,
    ResourceFileInfo,
    ValidationResult,
    PipelinesViewerSettings,
    PipelineSortBy,
    TreeItemType,
    PipelineTemplateType,
    PipelineTemplate,
    BundledPipelineManifest
} from './ui';

export { PIPELINE_TEMPLATES, PipelineSource } from './ui';

// Bundled Pipelines
export {
    BUNDLED_PIPELINES,
    getBundledPipelinesPath,
    getBundledPipelineManifest,
    getAllBundledPipelineManifests,
    isValidBundledPipelineId,
    getBundledPipelineDirectory,
    getBundledPipelineEntryPoint,
    // Read-only provider for bundled pipelines
    BUNDLED_PIPELINE_SCHEME,
    BundledPipelineContentProvider,
    createBundledPipelineUri,
    registerBundledPipelineProvider
} from './ui';

// Result Viewer (enhanced pipeline result display)
export {
    PipelineResultViewerProvider,
    registerPipelineResultViewer,
    PIPELINE_RESULTS_EXPORT_SCHEME,
    getResultViewerContent,
    getItemDetailContent,
    mapResultToNode,
    getItemPreview,
    formatDuration as formatResultDuration,
    getStatusIcon,
    getStatusClass
} from './ui';

export type {
    PipelineResultViewData,
    PipelineItemResultNode,
    ResultViewerMessage,
    ResultViewerMessageType,
    ResultViewerFilterState,
    ResultNodeType
} from './ui';
