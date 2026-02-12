/**
 * Job Template Manager
 *
 * Manages the persistence and retrieval of saved AI job templates.
 * Uses VS Code's Memento API for storage:
 * - Workspace templates in workspaceState
 * - Global templates in globalState
 *
 * Follows the same storage patterns as AIProcessManager and Global Notes.
 */

import * as vscode from 'vscode';
import {
    JobTemplate,
    JobTemplateScope,
    JobTemplateSortBy,
    SerializedJobTemplate,
    CreateTemplateOptions,
    validateTemplateName
} from './job-template-types';
import { getExtensionLogger, LogCategory } from './ai-service-logger';

// ============================================================================
// Storage Keys
// ============================================================================

/** Storage key for workspace-scoped templates */
const WORKSPACE_TEMPLATES_KEY = 'aiJobTemplates.workspace';

/** Storage key for global templates */
const GLOBAL_TEMPLATES_KEY = 'aiJobTemplates.global';

/** Storage key for last-used variable values (workspace-scoped) */
const TEMPLATE_VARIABLES_KEY = 'aiJobTemplates.variables';

/** Maximum number of templates per scope */
const MAX_TEMPLATES_PER_SCOPE = 50;

// ============================================================================
// JobTemplateManager
// ============================================================================

/**
 * Manages saved AI job templates with persistence via VS Code Memento API.
 */
export class JobTemplateManager {
    private context: vscode.ExtensionContext | undefined;

    private readonly _onDidChangeTemplates = new vscode.EventEmitter<void>();
    /** Event fired when templates are added, updated, or removed */
    readonly onDidChangeTemplates = this._onDidChangeTemplates.event;

    /**
     * Initialize the manager with extension context for persistence.
     *
     * @param context - VS Code extension context
     */
    initialize(context: vscode.ExtensionContext): void {
        this.context = context;
    }

    /**
     * Check if the manager is initialized.
     */
    isInitialized(): boolean {
        return this.context !== undefined;
    }

    // ========================================================================
    // Template CRUD
    // ========================================================================

    /**
     * Save a new template or overwrite an existing one by name.
     *
     * @param options - Template creation options
     * @returns The created/updated template, or undefined if validation fails
     */
    async saveTemplate(options: CreateTemplateOptions): Promise<JobTemplate | undefined> {
        if (!this.context) {
            return undefined;
        }

        const nameError = validateTemplateName(options.name);
        if (nameError) {
            return undefined;
        }

        const templates = this.getTemplatesByScope(options.scope);

        // Check for existing template with same name (case-insensitive)
        const existingIndex = templates.findIndex(
            t => t.name.toLowerCase() === options.name.trim().toLowerCase()
        );

        const now = new Date().toISOString();
        let template: JobTemplate;

        if (existingIndex >= 0) {
            // Update existing template
            template = {
                ...templates[existingIndex],
                prompt: options.prompt,
                model: options.model,
                workingDirectory: options.workingDirectory,
                type: options.type,
                skillName: options.skillName,
                // Preserve metadata, update timestamp
                createdAt: templates[existingIndex].createdAt,
            };
            templates[existingIndex] = template;
        } else {
            // Create new template
            template = {
                id: this.generateId(),
                name: options.name.trim(),
                scope: options.scope,
                prompt: options.prompt,
                model: options.model,
                workingDirectory: options.workingDirectory,
                type: options.type,
                skillName: options.skillName,
                createdAt: now,
                useCount: 0,
            };

            // Enforce maximum templates per scope
            if (templates.length >= MAX_TEMPLATES_PER_SCOPE) {
                // Remove least recently used template
                templates.sort((a, b) => {
                    const aTime = a.lastUsedAt || a.createdAt;
                    const bTime = b.lastUsedAt || b.createdAt;
                    return aTime.localeCompare(bTime);
                });
                templates.shift();
            }

            templates.push(template);
        }

        await this.saveTemplatesByScope(options.scope, templates);
        this._onDidChangeTemplates.fire();
        return template;
    }

    /**
     * Get a template by ID.
     *
     * @param id - Template ID
     * @returns The template or undefined
     */
    getTemplate(id: string): JobTemplate | undefined {
        return this.getAllTemplates().find(t => t.id === id);
    }

    /**
     * Get a template by name (case-insensitive).
     *
     * @param name - Template name
     * @param scope - Optional scope filter
     * @returns The template or undefined
     */
    getTemplateByName(name: string, scope?: JobTemplateScope): JobTemplate | undefined {
        const templates = scope ? this.getTemplatesByScope(scope) : this.getAllTemplates();
        return templates.find(t => t.name.toLowerCase() === name.toLowerCase());
    }

    /**
     * Get all templates from both scopes, sorted according to the given order.
     *
     * @param sortBy - Sort order (defaults to 'lastUsed')
     * @returns Sorted array of all templates
     */
    getAllTemplates(sortBy?: JobTemplateSortBy): JobTemplate[] {
        const workspaceTemplates = this.getTemplatesByScope('workspace');
        const globalTemplates = this.getTemplatesByScope('global');
        const all = [...workspaceTemplates, ...globalTemplates];
        return this.sortTemplates(all, sortBy || this.getSortSetting());
    }

    /**
     * Get templates filtered by scope.
     *
     * @param scope - 'workspace' or 'global'
     * @returns Templates in the given scope
     */
    getTemplatesByScope(scope: JobTemplateScope): JobTemplate[] {
        if (!this.context) {
            return [];
        }

        const storage = scope === 'workspace'
            ? this.context.workspaceState
            : this.context.globalState;

        const key = scope === 'workspace'
            ? WORKSPACE_TEMPLATES_KEY
            : GLOBAL_TEMPLATES_KEY;

        return storage.get<SerializedJobTemplate[]>(key, []);
    }

    /**
     * Delete a template by ID.
     *
     * @param id - Template ID to delete
     * @returns true if the template was found and deleted
     */
    async deleteTemplate(id: string): Promise<boolean> {
        // Try workspace first
        let templates = this.getTemplatesByScope('workspace');
        let index = templates.findIndex(t => t.id === id);
        if (index >= 0) {
            templates.splice(index, 1);
            await this.saveTemplatesByScope('workspace', templates);
            this._onDidChangeTemplates.fire();
            return true;
        }

        // Try global
        templates = this.getTemplatesByScope('global');
        index = templates.findIndex(t => t.id === id);
        if (index >= 0) {
            templates.splice(index, 1);
            await this.saveTemplatesByScope('global', templates);
            this._onDidChangeTemplates.fire();
            return true;
        }

        return false;
    }

    /**
     * Update a template's name.
     *
     * @param id - Template ID
     * @param newName - New name for the template
     * @returns true if the template was found and renamed
     */
    async renameTemplate(id: string, newName: string): Promise<boolean> {
        const nameError = validateTemplateName(newName);
        if (nameError) {
            return false;
        }

        // Check for name conflicts
        const existing = this.getTemplateByName(newName);
        if (existing && existing.id !== id) {
            return false;
        }

        for (const scope of ['workspace', 'global'] as JobTemplateScope[]) {
            const templates = this.getTemplatesByScope(scope);
            const index = templates.findIndex(t => t.id === id);
            if (index >= 0) {
                templates[index] = { ...templates[index], name: newName.trim() };
                await this.saveTemplatesByScope(scope, templates);
                this._onDidChangeTemplates.fire();
                return true;
            }
        }

        return false;
    }

    /**
     * Record a template usage (increments useCount and updates lastUsedAt).
     *
     * @param id - Template ID
     */
    async recordUsage(id: string): Promise<void> {
        for (const scope of ['workspace', 'global'] as JobTemplateScope[]) {
            const templates = this.getTemplatesByScope(scope);
            const index = templates.findIndex(t => t.id === id);
            if (index >= 0) {
                templates[index] = {
                    ...templates[index],
                    useCount: templates[index].useCount + 1,
                    lastUsedAt: new Date().toISOString(),
                };
                await this.saveTemplatesByScope(scope, templates);
                this._onDidChangeTemplates.fire();
                return;
            }
        }
    }

    /**
     * Check if a template name already exists.
     *
     * @param name - Template name to check
     * @param scope - Optional scope to restrict check
     * @returns true if a template with this name exists
     */
    hasTemplateName(name: string, scope?: JobTemplateScope): boolean {
        return this.getTemplateByName(name, scope) !== undefined;
    }

    /**
     * Get the total template count.
     */
    getTemplateCount(): number {
        return this.getAllTemplates().length;
    }

    /**
     * Clear all templates in the specified scope.
     *
     * @param scope - Scope to clear, or both if omitted
     */
    async clearTemplates(scope?: JobTemplateScope): Promise<void> {
        if (!this.context) {
            return;
        }

        if (!scope || scope === 'workspace') {
            await this.context.workspaceState.update(WORKSPACE_TEMPLATES_KEY, []);
        }
        if (!scope || scope === 'global') {
            await this.context.globalState.update(GLOBAL_TEMPLATES_KEY, []);
        }
        this._onDidChangeTemplates.fire();
    }

    // ========================================================================
    // Template Variable Values
    // ========================================================================

    /**
     * Get last-used variable values for a template.
     *
     * @param templateId - Template ID
     * @returns Record of variable name to last-used value
     */
    getLastUsedVariables(templateId: string): Record<string, string> {
        if (!this.context) {
            return {};
        }
        const allVars = this.context.workspaceState.get<Record<string, Record<string, string>>>(
            TEMPLATE_VARIABLES_KEY,
            {}
        );
        return allVars[templateId] || {};
    }

    /**
     * Save variable values for a template.
     *
     * @param templateId - Template ID
     * @param values - Variable name to value map
     */
    async saveLastUsedVariables(templateId: string, values: Record<string, string>): Promise<void> {
        if (!this.context) {
            return;
        }
        const allVars = this.context.workspaceState.get<Record<string, Record<string, string>>>(
            TEMPLATE_VARIABLES_KEY,
            {}
        );
        allVars[templateId] = values;
        await this.context.workspaceState.update(TEMPLATE_VARIABLES_KEY, allVars);
    }

    // ========================================================================
    // Dispose
    // ========================================================================

    dispose(): void {
        this._onDidChangeTemplates.dispose();
    }

    // ========================================================================
    // Private Helpers
    // ========================================================================

    /**
     * Save templates to the appropriate Memento storage.
     */
    private async saveTemplatesByScope(scope: JobTemplateScope, templates: JobTemplate[]): Promise<void> {
        if (!this.context) {
            return;
        }

        const storage = scope === 'workspace'
            ? this.context.workspaceState
            : this.context.globalState;

        const key = scope === 'workspace'
            ? WORKSPACE_TEMPLATES_KEY
            : GLOBAL_TEMPLATES_KEY;

        await storage.update(key, templates as SerializedJobTemplate[]);
    }

    /**
     * Sort templates by the given criteria.
     */
    private sortTemplates(templates: JobTemplate[], sortBy: JobTemplateSortBy): JobTemplate[] {
        return [...templates].sort((a, b) => {
            switch (sortBy) {
                case 'lastUsed': {
                    const aTime = a.lastUsedAt || a.createdAt;
                    const bTime = b.lastUsedAt || b.createdAt;
                    return bTime.localeCompare(aTime); // Most recent first
                }
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'useCount':
                    return b.useCount - a.useCount; // Most used first
                default:
                    return 0;
            }
        });
    }

    /**
     * Get the sort setting from VS Code configuration.
     */
    private getSortSetting(): JobTemplateSortBy {
        const config = vscode.workspace.getConfiguration('workspaceShortcuts.aiService.templates');
        const sortBy = config.get<string>('sortBy', 'lastUsed');
        if (sortBy === 'name' || sortBy === 'useCount' || sortBy === 'lastUsed') {
            return sortBy;
        }
        return 'lastUsed';
    }

    /**
     * Generate a unique template ID.
     */
    private generateId(): string {
        // Use a combination of timestamp and random suffix for uniqueness
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substring(2, 8);
        return `tmpl-${timestamp}-${random}`;
    }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: JobTemplateManager | undefined;

/**
 * Get the singleton JobTemplateManager instance.
 */
export function getJobTemplateManager(): JobTemplateManager {
    if (!instance) {
        instance = new JobTemplateManager();
    }
    return instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetJobTemplateManager(): void {
    if (instance) {
        instance.dispose();
    }
    instance = undefined;
}
