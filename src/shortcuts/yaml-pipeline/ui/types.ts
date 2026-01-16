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

/**
 * Pipeline template type identifiers
 */
export type PipelineTemplateType = 'custom' | 'data-fanout' | 'model-fanout';

/**
 * Pipeline template definition
 */
export interface PipelineTemplate {
    /** Template type identifier */
    type: PipelineTemplateType;
    /** Display name for the template */
    displayName: string;
    /** Description of what this template does */
    description: string;
    /** Sample CSV content for the template */
    sampleCSV: string;
}

/**
 * Available pipeline templates
 */
export const PIPELINE_TEMPLATES: Record<PipelineTemplateType, PipelineTemplate> = {
    'custom': {
        type: 'custom',
        displayName: 'Custom Pipeline',
        description: 'Start with a blank pipeline template that you can customize',
        sampleCSV: 'id,title,description\n1,Sample Item,A sample item for processing'
    },
    'data-fanout': {
        type: 'data-fanout',
        displayName: 'Data Fanout',
        description: 'Process a list of items in parallel - each mapper job runs against a single input item',
        sampleCSV: 'id,title,content\n1,Document 1,Content of document 1\n2,Document 2,Content of document 2\n3,Document 3,Content of document 3'
    },
    'model-fanout': {
        type: 'model-fanout',
        displayName: 'Model Fanout',
        description: 'Run the same data against multiple AI models and find consensus/conflicts',
        sampleCSV: 'model\ngpt-4\nclaude-sonnet\ngemini-pro'
    }
};
