/**
 * Pipeline Manager
 *
 * Manages pipeline packages stored in the pipelines folder.
 * Each pipeline is a package (directory) containing pipeline.yaml and resource files.
 * Handles discovery, parsing, validation, and file watching.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { PipelineInfo, ValidationResult, PipelinesViewerSettings, PipelineSortBy, ResourceFileInfo, PipelineTemplateType, PIPELINE_TEMPLATES } from './types';

/** Standard pipeline file names recognized by the system */
const PIPELINE_FILE_NAMES = ['pipeline.yaml', 'pipeline.yml'];

/**
 * Manages pipeline packages in the workspace.
 * A pipeline package is a directory containing pipeline.yaml and related resources.
 */
export class PipelineManager implements vscode.Disposable {
    private readonly workspaceRoot: string;
    private fileWatcher?: vscode.FileSystemWatcher;
    private folderWatcher?: vscode.FileSystemWatcher;
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
     * Get all pipeline packages from the pipelines folder.
     * Scans for directories containing pipeline.yaml or pipeline.yml.
     */
    async getPipelines(): Promise<PipelineInfo[]> {
        const pipelines: PipelineInfo[] = [];
        const pipelinesFolder = this.getPipelinesFolder();

        if (!fs.existsSync(pipelinesFolder)) {
            return pipelines;
        }

        const entries = fs.readdirSync(pipelinesFolder, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const packagePath = path.join(pipelinesFolder, entry.name);
                const pipelineFile = this.findPipelineFile(packagePath);

                if (pipelineFile) {
                    try {
                        const stats = fs.statSync(pipelineFile);
                        const pipelineInfo = await this.parsePipelinePackage(
                            packagePath,
                            entry.name,
                            pipelineFile,
                            stats
                        );
                        pipelines.push(pipelineInfo);
                    } catch (error) {
                        console.warn(`Failed to read pipeline package ${packagePath}:`, error);
                    }
                }
            }
        }

        return pipelines;
    }

    /**
     * Get a specific pipeline by package name
     */
    async getPipeline(packageName: string): Promise<PipelineInfo | undefined> {
        const pipelines = await this.getPipelines();
        return pipelines.find(p => p.packageName === packageName);
    }

    /**
     * Find the pipeline file (pipeline.yaml or pipeline.yml) in a package directory
     */
    private findPipelineFile(packagePath: string): string | undefined {
        for (const fileName of PIPELINE_FILE_NAMES) {
            const filePath = path.join(packagePath, fileName);
            if (fs.existsSync(filePath)) {
                return filePath;
            }
        }
        return undefined;
    }

    /**
     * Create a new pipeline package with directory structure
     * @param name Pipeline name
     * @param templateType Optional template type (defaults to 'custom')
     * @returns The path to the created pipeline.yaml file
     */
    async createPipeline(name: string, templateType: PipelineTemplateType = 'custom'): Promise<string> {
        this.ensurePipelinesFolderExists();

        const sanitizedName = this.sanitizeFileName(name);
        const packagePath = path.join(this.getPipelinesFolder(), sanitizedName);

        if (fs.existsSync(packagePath)) {
            throw new Error(`Pipeline "${name}" already exists`);
        }

        // Create the package directory
        fs.mkdirSync(packagePath, { recursive: true });

        // Create pipeline.yaml in the package based on template type
        const filePath = path.join(packagePath, 'pipeline.yaml');
        const template = this.getPipelineTemplate(name, templateType);
        fs.writeFileSync(filePath, template, 'utf8');

        // Create a sample input.csv file based on template type
        const templateDef = PIPELINE_TEMPLATES[templateType];
        fs.writeFileSync(path.join(packagePath, 'input.csv'), templateDef.sampleCSV, 'utf8');

        return filePath;
    }

    /**
     * Create a new pipeline package from a specific template
     * @param name Pipeline name
     * @param templateType Template type to use
     * @returns The path to the created pipeline.yaml file
     */
    async createPipelineFromTemplate(name: string, templateType: PipelineTemplateType): Promise<string> {
        return this.createPipeline(name, templateType);
    }

    /**
     * Get the package path for a pipeline
     */
    getPackagePath(pipelineFilePath: string): string {
        return path.dirname(pipelineFilePath);
    }

    /**
     * Rename a pipeline package
     * @param oldPath Path to the pipeline.yaml file
     * @param newName New name for the pipeline package
     * @returns The new file path to pipeline.yaml
     */
    async renamePipeline(oldPath: string, newName: string): Promise<string> {
        const oldPackagePath = this.getPackagePath(oldPath);
        if (!fs.existsSync(oldPackagePath)) {
            throw new Error(`Pipeline package not found: ${oldPackagePath}`);
        }

        const sanitizedName = this.sanitizeFileName(newName);
        const pipelinesFolder = this.getPipelinesFolder();
        const newPackagePath = path.join(pipelinesFolder, sanitizedName);

        if (oldPackagePath !== newPackagePath && fs.existsSync(newPackagePath)) {
            throw new Error(`Pipeline "${newName}" already exists`);
        }

        // Update the name field in the YAML content
        const content = fs.readFileSync(oldPath, 'utf8');
        const parsed = yaml.load(content) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
            parsed.name = newName;
            const updatedContent = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
            fs.writeFileSync(oldPath, updatedContent, 'utf8');
        }

        // Rename the package directory if name changed
        if (oldPackagePath !== newPackagePath) {
            fs.renameSync(oldPackagePath, newPackagePath);
        }

        return path.join(newPackagePath, 'pipeline.yaml');
    }

    /**
     * Delete a pipeline package (directory and all contents)
     * @param filePath Path to the pipeline.yaml file
     */
    async deletePipeline(filePath: string): Promise<void> {
        const packagePath = this.getPackagePath(filePath);
        if (!fs.existsSync(packagePath)) {
            throw new Error(`Pipeline package not found: ${packagePath}`);
        }

        // Remove the entire package directory
        fs.rmSync(packagePath, { recursive: true, force: true });
    }

    /**
     * Validate a pipeline YAML file and its resource files
     */
    async validatePipeline(filePath: string): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!fs.existsSync(filePath)) {
            return { valid: false, errors: ['File not found'], warnings: [] };
        }

        const packagePath = this.getPackagePath(filePath);

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
                
                // Must have either "items" or "from"
                const hasItems = Array.isArray(input.items);
                const hasFrom = input.from !== undefined;
                
                if (!hasItems && !hasFrom) {
                    errors.push('Input must have either "items" (inline array) or "from" (CSV source or inline array)');
                } else if (hasItems && hasFrom) {
                    errors.push('Input cannot have both "items" and "from" - use one or the other');
                } else if (hasFrom) {
                    // "from" can be either a CSV source object or an inline array
                    if (Array.isArray(input.from)) {
                        // Inline array in "from" - valid for multi-model fanout patterns
                        const fromArray = input.from as unknown[];
                        if (fromArray.length === 0) {
                            warnings.push('Input "from" array is empty');
                        }
                    } else {
                        // Should be a CSV source object
                        const from = input.from as Record<string, unknown>;
                        if (from.type !== 'csv') {
                            errors.push(`Unsupported input source type: ${from.type}. Only "csv" is supported for file sources.`);
                        }
                        if (!from.path) {
                            errors.push('Missing "input.from.path" field for CSV source');
                        } else {
                            // Validate that the CSV file exists relative to the package
                            const csvPath = this.resolveResourcePath(from.path as string, packagePath);
                            if (!fs.existsSync(csvPath)) {
                                warnings.push(`Input file not found: ${from.path} (expected at ${csvPath})`);
                            }
                        }
                    }
                } else if (hasItems) {
                    // Validate inline items
                    const items = input.items as unknown[];
                    if (items.length === 0) {
                        warnings.push('Input "items" array is empty');
                    }
                }
                
                // Check for old format and provide helpful error
                if (input.type !== undefined || input.path !== undefined) {
                    errors.push('Invalid input format: use "input.from.type" and "input.from.path" instead of "input.type" and "input.path"');
                }
            }

            if (!parsed.map) {
                errors.push('Missing "map" field');
            } else {
                const map = parsed.map as Record<string, unknown>;
                if (!map.prompt) {
                    errors.push('Missing "map.prompt" field');
                }
                // map.output is optional - if omitted, text mode is used (raw AI response)
                if (map.output !== undefined && !Array.isArray(map.output)) {
                    errors.push('"map.output" must be an array if provided');
                }
            }

            if (!parsed.reduce) {
                errors.push('Missing "reduce" field');
            } else {
                const reduce = parsed.reduce as Record<string, unknown>;
                const validReduceTypes = ['list', 'table', 'json', 'csv', 'ai', 'text'];
                if (!validReduceTypes.includes(reduce.type as string)) {
                    errors.push(`Unsupported reduce type: ${reduce.type}. Supported: ${validReduceTypes.join(', ')}`);
                }

                // Validate AI reduce configuration
                if (reduce.type === 'ai') {
                    if (!reduce.prompt || typeof reduce.prompt !== 'string') {
                        errors.push('reduce.prompt is required when reduce.type is "ai"');
                    }
                    // reduce.output is optional for AI reduce - if omitted, returns raw text
                    if (reduce.output !== undefined && !Array.isArray(reduce.output)) {
                        errors.push('reduce.output must be an array if provided');
                    }
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
     * Resolve a resource path relative to a package directory
     * Supports relative paths (./file.csv, ../shared/file.csv) and absolute paths
     */
    resolveResourcePath(resourcePath: string, packagePath: string): string {
        if (path.isAbsolute(resourcePath)) {
            return resourcePath;
        }
        return path.resolve(packagePath, resourcePath);
    }

    /**
     * Set up file watching for the pipelines folder.
     * Watches for changes to pipeline.yaml/yml files in any package subdirectory.
     */
    watchPipelinesFolder(callback: () => void): vscode.Disposable {
        this.refreshCallback = callback;
        this.disposeWatcher();

        const pipelinesFolder = this.getPipelinesFolder();

        // Create the folder if it doesn't exist so watcher works
        this.ensurePipelinesFolderExists();

        // Watch for pipeline.yaml/yml files in package subdirectories
        const pipelinePattern = new vscode.RelativePattern(pipelinesFolder, '*/pipeline.{yaml,yml}');
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pipelinePattern);

        this.fileWatcher.onDidChange(() => this.debounceRefresh());
        this.fileWatcher.onDidCreate(() => this.debounceRefresh());
        this.fileWatcher.onDidDelete(() => this.debounceRefresh());

        // Also watch for package directory additions/deletions
        const folderPattern = new vscode.RelativePattern(pipelinesFolder, '*');
        this.folderWatcher = vscode.workspace.createFileSystemWatcher(folderPattern);

        this.folderWatcher.onDidCreate(() => this.debounceRefresh());
        this.folderWatcher.onDidDelete(() => this.debounceRefresh());

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
     * Parse a pipeline package and extract metadata
     */
    private async parsePipelinePackage(
        packagePath: string,
        packageName: string,
        pipelineFilePath: string,
        stats: fs.Stats
    ): Promise<PipelineInfo> {
        const relativePath = path.relative(this.workspaceRoot, packagePath);
        const validation = await this.validatePipeline(pipelineFilePath);

        let name = packageName;
        let description: string | undefined;

        try {
            const content = fs.readFileSync(pipelineFilePath, 'utf8');
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
            // Use package name as fallback
        }

        // Get resource files in the package
        const resourceFiles = this.getResourceFiles(packagePath);

        return {
            packageName,
            packagePath,
            filePath: pipelineFilePath,
            relativePath,
            name,
            description,
            lastModified: stats.mtime,
            size: stats.size,
            isValid: validation.valid,
            validationErrors: validation.errors.length > 0 ? validation.errors : undefined,
            resourceFiles
        };
    }

    /**
     * Get all resource files in a pipeline package (excluding pipeline.yaml)
     */
    private getResourceFiles(packagePath: string): ResourceFileInfo[] {
        const resources: ResourceFileInfo[] = [];

        const scanDirectory = (dirPath: string, basePath: string = '') => {
            try {
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    const relativePath = basePath ? path.join(basePath, entry.name) : entry.name;

                    if (entry.isDirectory()) {
                        // Recursively scan subdirectories
                        scanDirectory(fullPath, relativePath);
                    } else if (entry.isFile()) {
                        // Skip pipeline.yaml/yml files
                        if (PIPELINE_FILE_NAMES.includes(entry.name)) {
                            continue;
                        }

                        try {
                            const stats = fs.statSync(fullPath);
                            resources.push({
                                fileName: entry.name,
                                filePath: fullPath,
                                relativePath,
                                size: stats.size,
                                fileType: this.getFileType(entry.name)
                            });
                        } catch {
                            // Skip files we can't read
                        }
                    }
                }
            } catch {
                // Skip directories we can't read
            }
        };

        scanDirectory(packagePath);
        return resources;
    }

    /**
     * Determine the file type based on extension
     */
    private getFileType(fileName: string): ResourceFileInfo['fileType'] {
        const ext = path.extname(fileName).toLowerCase();
        switch (ext) {
            case '.csv':
                return 'csv';
            case '.json':
                return 'json';
            case '.txt':
            case '.md':
                return 'txt';
            case '.template':
            case '.tpl':
            case '.hbs':
            case '.mustache':
                return 'template';
            default:
                return 'other';
        }
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
     * Get pipeline template content based on template type
     * Paths are relative to the package directory
     */
    private getPipelineTemplate(name: string, templateType: PipelineTemplateType): string {
        switch (templateType) {
            case 'data-fanout':
                return this.getDataFanoutTemplate(name);
            case 'model-fanout':
                return this.getModelFanoutTemplate(name);
            case 'custom':
            default:
                return this.getCustomTemplate(name);
        }
    }

    /**
     * Get custom (default) pipeline template
     */
    private getCustomTemplate(name: string): string {
        return `# Pipeline: ${name}
name: "${name}"
description: "Description of what this pipeline does"

input:
  # Path is relative to this pipeline's package directory
  from:
    type: csv
    path: "input.csv"
  # Optional: Define parameters accessible in reduce.prompt via {{paramName}}
  # parameters:
  #   - name: projectName
  #     value: "My Project"

map:
  prompt: |
    Process the following item:
    {{title}}
    {{description}}

    Respond with JSON containing your analysis.
  # Output fields expected from AI (structured mode)
  output:
    - result
    - confidence
  # Text mode: Omit 'output' to get raw AI response without JSON parsing
  # (useful for interactive conversations)
  #
  # Parallel execution: Number of concurrent AI calls (default: 5)
  # parallel: 5
  #
  # Model: Override the default AI model
  # model: gpt-4
  #
  # Timeout for each AI call in milliseconds (default: 300000 = 5 minutes)
  # timeoutMs: 300000

reduce:
  # Reduce types:
  #   - list: Markdown formatted list
  #   - table: Markdown table
  #   - json: JSON array
  #   - csv: CSV format
  #   - text: Pure text concatenation (for text mode map results)
  #   - ai: AI-powered synthesis
  type: ai
  prompt: |
    You analyzed {{COUNT}} items:
    {{RESULTS}}

    Create a summary with key insights.
  # Output fields for structured AI reduce
  output:
    - summary
  # Text mode AI reduce: Omit 'output' to get raw AI response
  # (useful when you want natural language output, not JSON)
  #
  # Model: Override the default AI model for reduce
  # model: gpt-4
`;
    }

    /**
     * Get Data Fanout pipeline template
     * Input is a list and each mapper job runs against a single input item
     */
    private getDataFanoutTemplate(name: string): string {
        return `# Pipeline: ${name}
# Template: Data Fanout
# Each row in the CSV is processed independently by the AI
name: "${name}"
description: "Process a list of items in parallel - each mapper job runs against a single input"

input:
  # Load items from CSV - each row becomes an independent map job
  from:
    type: csv
    path: "input.csv"
  # Optional: Limit number of items to process
  # limit: 10

map:
  # Each item from the CSV is processed independently
  prompt: |
    Analyze the following item:
    
    ID: {{id}}
    Title: {{title}}
    Content: {{content}}
    
    Provide a detailed analysis including:
    1. Key themes or topics
    2. Sentiment (positive/negative/neutral)
    3. Action items if any
    
    Respond with JSON containing your analysis.
  output:
    - themes
    - sentiment
    - actionItems
    - summary
  # Process multiple items in parallel (default: 5)
  parallel: 5

reduce:
  # Aggregate all results with AI synthesis
  type: ai
  prompt: |
    You analyzed {{COUNT}} items with the following results:
    
    {{RESULTS}}
    
    Successful: {{SUCCESS_COUNT}}
    Failed: {{FAILURE_COUNT}}
    
    Please provide:
    1. An executive summary of all findings
    2. Common themes across items
    3. Overall sentiment distribution
    4. Prioritized action items
  output:
    - executiveSummary
    - commonThemes
    - sentimentDistribution
    - prioritizedActions
`;
    }

    /**
     * Get Model Fanout pipeline template
     * Run the same data against different models and find consensus/conflicts
     */
    private getModelFanoutTemplate(name: string): string {
        return `# Pipeline: ${name}
# Template: Model Fanout
# Run the same prompt against multiple AI models and compare results
name: "${name}"
description: "Run the same data against multiple AI models and find consensus/conflicts"

input:
  # List of models to use - each becomes a separate map job
  from:
    - model: gpt-4
    - model: claude-sonnet
    - model: gemini-pro
  # Define the shared data as parameters (accessible via {{paramName}})
  parameters:
    - name: codeToReview
      value: |
        function calculateTotal(items) {
          let total = 0;
          for (let i = 0; i <= items.length; i++) {
            total += items[i].price;
          }
          return total;
        }
    - name: reviewContext
      value: "JavaScript function for calculating shopping cart total"

map:
  # The same prompt is sent to each model specified in input.from
  prompt: |
    Review the following code:
    
    Context: {{reviewContext}}
    
    \`\`\`javascript
    {{codeToReview}}
    \`\`\`
    
    Analyze for:
    1. Bugs or errors
    2. Performance issues
    3. Security concerns
    4. Code style improvements
    
    Provide your analysis as JSON.
  output:
    - bugs
    - performanceIssues
    - securityConcerns
    - styleImprovements
    - overallScore
  # Use the model specified in each input item
  model: "{{model}}"
  # Run all models in parallel
  parallel: 3

reduce:
  # AI-powered consensus finding
  type: ai
  prompt: |
    Multiple AI models ({{COUNT}}) reviewed the same code:
    
    {{RESULTS}}
    
    Successful responses: {{SUCCESS_COUNT}}
    Failed responses: {{FAILURE_COUNT}}
    
    Please analyze the responses and provide:
    1. CONSENSUS: Issues that multiple models agree on
    2. CONFLICTS: Areas where models disagree
    3. UNIQUE INSIGHTS: Valuable points raised by only one model
    4. FINAL RECOMMENDATION: Your synthesized recommendation
    
    Weight consensus items higher in your final recommendation.
  output:
    - consensus
    - conflicts
    - uniqueInsights
    - finalRecommendation
    - confidenceScore
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

        this.folderWatcher?.dispose();
        this.folderWatcher = undefined;

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
