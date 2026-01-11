/**
 * Pipeline Manager
 *
 * Manages pipeline files stored in the pipelines folder.
 * Handles discovery, parsing, validation, and file watching.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { PipelineInfo, ValidationResult, PipelinesViewerSettings, PipelineSortBy } from './types';

/**
 * Manages pipeline YAML files in the workspace
 */
export class PipelineManager implements vscode.Disposable {
    private readonly workspaceRoot: string;
    private fileWatcher?: vscode.FileSystemWatcher;
    private debounceTimer?: NodeJS.Timeout;
    private refreshCallback?: () => void;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Get the pipelines folder path from settings
     */
    getPipelinesFolder(): string {
        const settings = this.getSettings();
        const folderPath = settings.folderPath || '.vscode/pipelines';
        return path.isAbsolute(folderPath)
            ? folderPath
            : path.join(this.workspaceRoot, folderPath);
    }

    /**
     * Ensure the pipelines folder exists
     */
    ensurePipelinesFolderExists(): void {
        const pipelinesFolder = this.getPipelinesFolder();
        if (!fs.existsSync(pipelinesFolder)) {
            fs.mkdirSync(pipelinesFolder, { recursive: true });
        }
    }

    /**
     * Get all pipeline files from the pipelines folder
     */
    async getPipelines(): Promise<PipelineInfo[]> {
        const pipelines: PipelineInfo[] = [];
        const pipelinesFolder = this.getPipelinesFolder();

        if (!fs.existsSync(pipelinesFolder)) {
            return pipelines;
        }

        const files = fs.readdirSync(pipelinesFolder);
        for (const file of files) {
            if (this.isPipelineFile(file)) {
                const filePath = path.join(pipelinesFolder, file);
                try {
                    const stats = fs.statSync(filePath);
                    if (stats.isFile()) {
                        const pipelineInfo = await this.parsePipelineFile(filePath, file, stats);
                        pipelines.push(pipelineInfo);
                    }
                } catch (error) {
                    console.warn(`Failed to read pipeline file ${filePath}:`, error);
                }
            }
        }

        return pipelines;
    }

    /**
     * Get a specific pipeline by file name
     */
    async getPipeline(fileName: string): Promise<PipelineInfo | undefined> {
        const pipelines = await this.getPipelines();
        return pipelines.find(p => p.fileName === fileName);
    }

    /**
     * Create a new pipeline file
     * @returns The path to the created file
     */
    async createPipeline(name: string): Promise<string> {
        this.ensurePipelinesFolderExists();

        const sanitizedName = this.sanitizeFileName(name);
        const filePath = path.join(this.getPipelinesFolder(), `${sanitizedName}.yaml`);

        if (fs.existsSync(filePath)) {
            throw new Error(`Pipeline "${name}" already exists`);
        }

        // Create a basic pipeline template
        const template = this.getDefaultPipelineTemplate(name);
        fs.writeFileSync(filePath, template, 'utf8');

        return filePath;
    }

    /**
     * Rename a pipeline file
     * @returns The new file path
     */
    async renamePipeline(oldPath: string, newName: string): Promise<string> {
        if (!fs.existsSync(oldPath)) {
            throw new Error(`Pipeline file not found: ${oldPath}`);
        }

        const sanitizedName = this.sanitizeFileName(newName);
        const directory = path.dirname(oldPath);
        const ext = path.extname(oldPath);
        const newPath = path.join(directory, `${sanitizedName}${ext}`);

        if (oldPath !== newPath && fs.existsSync(newPath)) {
            throw new Error(`Pipeline "${newName}" already exists`);
        }

        // Update the name field in the YAML content
        const content = fs.readFileSync(oldPath, 'utf8');
        const parsed = yaml.load(content) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
            parsed.name = newName;
            const updatedContent = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
            fs.writeFileSync(newPath, updatedContent, 'utf8');
            if (oldPath !== newPath) {
                fs.unlinkSync(oldPath);
            }
        } else {
            fs.renameSync(oldPath, newPath);
        }

        return newPath;
    }

    /**
     * Delete a pipeline file
     */
    async deletePipeline(filePath: string): Promise<void> {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Pipeline file not found: ${filePath}`);
        }

        fs.unlinkSync(filePath);
    }

    /**
     * Validate a pipeline YAML file
     */
    async validatePipeline(filePath: string): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!fs.existsSync(filePath)) {
            return { valid: false, errors: ['File not found'], warnings: [] };
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = yaml.load(content) as Record<string, unknown>;

            if (!parsed || typeof parsed !== 'object') {
                return { valid: false, errors: ['Invalid YAML: not an object'], warnings: [] };
            }

            // Validate required fields
            if (!parsed.name || typeof parsed.name !== 'string') {
                errors.push('Missing or invalid "name" field');
            }

            if (!parsed.input) {
                errors.push('Missing "input" field');
            } else {
                const input = parsed.input as Record<string, unknown>;
                if (input.type !== 'csv') {
                    errors.push(`Unsupported input type: ${input.type}. Only "csv" is supported.`);
                }
                if (!input.path) {
                    errors.push('Missing "input.path" field');
                }
            }

            if (!parsed.map) {
                errors.push('Missing "map" field');
            } else {
                const map = parsed.map as Record<string, unknown>;
                if (!map.prompt) {
                    errors.push('Missing "map.prompt" field');
                }
                if (!map.output || !Array.isArray(map.output) || (map.output as unknown[]).length === 0) {
                    errors.push('"map.output" must be a non-empty array');
                }
            }

            if (!parsed.reduce) {
                errors.push('Missing "reduce" field');
            } else {
                const reduce = parsed.reduce as Record<string, unknown>;
                const validReduceTypes = ['list', 'table', 'json', 'csv'];
                if (!validReduceTypes.includes(reduce.type as string)) {
                    errors.push(`Unsupported reduce type: ${reduce.type}. Supported: ${validReduceTypes.join(', ')}`);
                }
            }

            // Optional warnings
            if (parsed.description === undefined) {
                warnings.push('Consider adding a "description" field');
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { valid: false, errors: [`YAML parse error: ${message}`], warnings: [] };
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Set up file watching for the pipelines folder
     */
    watchPipelinesFolder(callback: () => void): vscode.Disposable {
        this.refreshCallback = callback;
        this.disposeWatcher();

        const pipelinesFolder = this.getPipelinesFolder();

        // Create the folder if it doesn't exist so watcher works
        this.ensurePipelinesFolderExists();

        const pattern = new vscode.RelativePattern(pipelinesFolder, '*.{yaml,yml}');
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.fileWatcher.onDidChange(() => this.debounceRefresh());
        this.fileWatcher.onDidCreate(() => this.debounceRefresh());
        this.fileWatcher.onDidDelete(() => this.debounceRefresh());

        return {
            dispose: () => this.disposeWatcher()
        };
    }

    /**
     * Get settings from VSCode configuration
     */
    getSettings(): PipelinesViewerSettings {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.pipelinesViewer');
        return {
            enabled: config.get<boolean>('enabled', true),
            folderPath: config.get<string>('folderPath', '.vscode/pipelines'),
            sortBy: config.get<PipelineSortBy>('sortBy', 'name')
        };
    }

    /**
     * Check if a file is a pipeline file (YAML extension)
     */
    private isPipelineFile(fileName: string): boolean {
        const ext = path.extname(fileName).toLowerCase();
        return ext === '.yaml' || ext === '.yml';
    }

    /**
     * Parse a pipeline file and extract metadata
     */
    private async parsePipelineFile(
        filePath: string,
        fileName: string,
        stats: fs.Stats
    ): Promise<PipelineInfo> {
        const relativePath = path.relative(this.workspaceRoot, filePath);
        const validation = await this.validatePipeline(filePath);

        let name = path.basename(fileName, path.extname(fileName));
        let description: string | undefined;

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const parsed = yaml.load(content) as Record<string, unknown>;

            if (parsed && typeof parsed === 'object') {
                if (typeof parsed.name === 'string') {
                    name = parsed.name;
                }
                if (typeof parsed.description === 'string') {
                    description = parsed.description;
                }
            }
        } catch (error) {
            // Use file name as fallback
        }

        return {
            fileName,
            filePath,
            relativePath,
            name,
            description,
            lastModified: stats.mtime,
            size: stats.size,
            isValid: validation.valid,
            validationErrors: validation.errors.length > 0 ? validation.errors : undefined
        };
    }

    /**
     * Sanitize a file name to remove invalid characters
     */
    private sanitizeFileName(name: string): string {
        return name
            .replace(/[<>:"/\\|?*]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .trim();
    }

    /**
     * Get a default pipeline template
     */
    private getDefaultPipelineTemplate(name: string): string {
        return `# Pipeline: ${name}
name: "${name}"
description: "Description of what this pipeline does"

input:
  type: csv
  path: "data/input.csv"

map:
  prompt: |
    Process the following item:
    {{column_name}}
    
    Respond with JSON containing your analysis.
  output:
    - result
    - confidence

reduce:
  type: json
`;
    }

    /**
     * Debounced refresh to avoid excessive updates
     */
    private debounceRefresh(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.refreshCallback?.();
        }, 300);
    }

    /**
     * Dispose file watcher
     */
    private disposeWatcher(): void {
        this.fileWatcher?.dispose();
        this.fileWatcher = undefined;

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
    }

    /**
     * Dispose all resources
     */
    dispose(): void {
        this.disposeWatcher();
    }
}
