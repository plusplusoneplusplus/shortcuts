/**
 * UI Types for Pipeline Panel
 *
 * Types specific to the VSCode Pipeline Panel UI components.
 */

/**
 * Information about a pipeline file discovered in the workspace
 */
export interface PipelineInfo {
    /** File name (e.g., "code-review.yaml") */
    fileName: string;
    /** Absolute path to the file */
    filePath: string;
    /** Path relative to workspace root */
    relativePath: string;

    /** Pipeline name from YAML 'name' field */
    name: string;
    /** Optional description from YAML 'description' field */
    description?: string;

    /** File last modified time */
    lastModified: Date;
    /** File size in bytes */
    size: number;

    /** Whether the pipeline YAML is valid */
    isValid: boolean;
    /** Validation error messages if invalid */
    validationErrors?: string[];
}

/**
 * Result of pipeline validation
 */
export interface ValidationResult {
    /** Whether the pipeline is valid */
    valid: boolean;
    /** Error messages if invalid */
    errors: string[];
    /** Warning messages (non-blocking) */
    warnings: string[];
}

/** Sort options for pipelines */
export type PipelineSortBy = 'name' | 'modifiedDate';

/**
 * Settings for the Pipelines Viewer feature
 */
export interface PipelinesViewerSettings {
    /** Whether the pipelines viewer is enabled */
    enabled: boolean;
    /** Path to pipelines folder relative to workspace root */
    folderPath: string;
    /** How to sort pipelines in the view */
    sortBy: PipelineSortBy;
}
