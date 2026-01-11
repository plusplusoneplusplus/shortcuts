/**
 * UI Types for Pipeline Panel
 *
 * Types specific to the VSCode Pipeline Panel UI components.
 */

/**
 * Information about a pipeline package discovered in the workspace.
 * A pipeline package is a directory containing pipeline.yaml and resource files.
 */
export interface PipelineInfo {
    /** Package name (directory name, e.g., "run-tests") */
    packageName: string;
    /** Absolute path to the package directory */
    packagePath: string;
    /** Absolute path to the pipeline.yaml file */
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

    /** Resource files in the package (CSV, templates, etc.) */
    resourceFiles?: ResourceFileInfo[];
}

/**
 * Information about a resource file within a pipeline package
 */
export interface ResourceFileInfo {
    /** File name (e.g., "input.csv") */
    fileName: string;
    /** Absolute path to the file */
    filePath: string;
    /** Path relative to the package directory */
    relativePath: string;
    /** File size in bytes */
    size: number;
    /** File type based on extension */
    fileType: 'csv' | 'json' | 'txt' | 'template' | 'other';
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

/**
 * Tree item type enumeration for UI rendering
 */
export type TreeItemType = 'package' | 'resource';
