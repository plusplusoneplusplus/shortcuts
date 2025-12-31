/**
 * Represents a task markdown file
 */
export interface Task {
    /** Filename without .md extension */
    name: string;
    /** Absolute path to the .md file */
    filePath: string;
    /** Last modified time for sorting */
    modifiedTime: Date;
    /** Whether task is in archive folder */
    isArchived: boolean;
}

/** Sort options for tasks */
export type TaskSortBy = 'name' | 'modifiedDate';

/** Settings for the Tasks Viewer feature */
export interface TasksViewerSettings {
    enabled: boolean;
    /** Path to tasks folder relative to workspace root */
    folderPath: string;
    showArchived: boolean;
    sortBy: TaskSortBy;
}
