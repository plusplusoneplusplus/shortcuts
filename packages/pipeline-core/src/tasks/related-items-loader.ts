/**
 * Related Items Loader
 * 
 * Handles reading and writing of related.yaml files in feature folders.
 * Extracted from the VS Code extension for use in CLI tools and other Node.js consumers.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { RelatedItem, RelatedItemsConfig } from './types';
import { getLogger, LogCategory } from '../logger';

/** Name of the related items configuration file */
export const RELATED_ITEMS_FILENAME = 'related.yaml';

/**
 * Load related items config from a feature folder
 * @param folderPath Absolute path to the feature folder
 * @returns RelatedItemsConfig or undefined if file doesn't exist
 */
export async function loadRelatedItems(folderPath: string): Promise<RelatedItemsConfig | undefined> {
    const filePath = path.join(folderPath, RELATED_ITEMS_FILENAME);
    
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }

        const content = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = yaml.load(content) as RelatedItemsConfig;
        
        // Validate structure
        if (!parsed || typeof parsed !== 'object') {
            return undefined;
        }
        
        // Ensure items array exists
        if (!Array.isArray(parsed.items)) {
            parsed.items = [];
        }
        
        return parsed;
    } catch (error) {
        const logger = getLogger();
        logger.error(LogCategory.TASKS, `Error loading related items from ${folderPath}`, error instanceof Error ? error : new Error(String(error)));
        return undefined;
    }
}

/**
 * Save related items config to a feature folder
 * @param folderPath Absolute path to the feature folder
 * @param config Configuration to save
 */
export async function saveRelatedItems(folderPath: string, config: RelatedItemsConfig): Promise<void> {
    const filePath = path.join(folderPath, RELATED_ITEMS_FILENAME);
    
    // Update timestamp
    config.lastUpdated = new Date().toISOString();
    
    // Generate YAML with header comment
    const yamlContent = generateYamlContent(config, path.basename(folderPath));
    
    await fs.promises.writeFile(filePath, yamlContent, 'utf-8');
}

/**
 * Check if a feature folder has related items
 * @param folderPath Absolute path to the feature folder
 * @returns true if related.yaml exists
 */
export function hasRelatedItems(folderPath: string): boolean {
    const filePath = path.join(folderPath, RELATED_ITEMS_FILENAME);
    return fs.existsSync(filePath);
}

/**
 * Delete related items file from a feature folder
 * @param folderPath Absolute path to the feature folder
 */
export async function deleteRelatedItems(folderPath: string): Promise<void> {
    const filePath = path.join(folderPath, RELATED_ITEMS_FILENAME);
    
    if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
    }
}

/**
 * Remove a single item from related items config
 * @param folderPath Absolute path to the feature folder
 * @param itemPath Path of the file item or commit hash to remove
 * @returns true if item was removed, false if not found
 */
export async function removeRelatedItem(folderPath: string, itemPath: string): Promise<boolean> {
    const config = await loadRelatedItems(folderPath);
    
    if (!config) {
        return false;
    }
    
    const initialLength = config.items.length;
    config.items = config.items.filter(item => {
        // Match by path for files, by hash for commits
        if (item.type === 'file') {
            return item.path !== itemPath;
        } else if (item.type === 'commit') {
            return item.hash !== itemPath;
        }
        return true;
    });
    
    if (config.items.length === initialLength) {
        return false;
    }
    
    await saveRelatedItems(folderPath, config);
    return true;
}

/**
 * Merge new items into existing related items config
 * Deduplicates by path for files and hash for commits
 * @param folderPath Absolute path to the feature folder
 * @param newItems New items to merge
 * @param newDescription Optional new description
 * @returns Updated config
 */
export async function mergeRelatedItems(
    folderPath: string, 
    newItems: RelatedItem[],
    newDescription?: string
): Promise<RelatedItemsConfig> {
    const existing = await loadRelatedItems(folderPath);
    
    if (!existing) {
        // No existing config, create new
        const config: RelatedItemsConfig = {
            description: newDescription || '',
            items: newItems
        };
        await saveRelatedItems(folderPath, config);
        return config;
    }
    
    // Create map of existing items for deduplication
    const existingPaths = new Set<string>();
    const existingHashes = new Set<string>();
    
    for (const item of existing.items) {
        if (item.type === 'file' && item.path) {
            existingPaths.add(item.path);
        } else if (item.type === 'commit' && item.hash) {
            existingHashes.add(item.hash);
        }
    }
    
    // Add new items that don't exist
    for (const item of newItems) {
        if (item.type === 'file' && item.path && !existingPaths.has(item.path)) {
            existing.items.push(item);
        } else if (item.type === 'commit' && item.hash && !existingHashes.has(item.hash)) {
            existing.items.push(item);
        }
    }
    
    // Update description if provided
    if (newDescription) {
        existing.description = newDescription;
    }
    
    await saveRelatedItems(folderPath, existing);
    return existing;
}

/**
 * Generate YAML content with header comment
 */
function generateYamlContent(config: RelatedItemsConfig, featureName: string): string {
    const header = `# Auto-generated by AI Discovery
# Last updated: ${config.lastUpdated || new Date().toISOString()}
# Feature: ${featureName}

`;
    
    const yamlContent = yaml.dump(config, {
        indent: 2,
        lineWidth: 120,
        quotingType: '"',
        forceQuotes: false
    });
    
    return header + yamlContent;
}

/**
 * Get the path to related.yaml for a feature folder
 */
export function getRelatedItemsPath(folderPath: string): string {
    return path.join(folderPath, RELATED_ITEMS_FILENAME);
}

/**
 * Categorize an item based on its path or other properties
 */
export function categorizeItem(filePath: string): 'source' | 'test' | 'doc' | 'config' {
    const lowerPath = filePath.toLowerCase();
    const basename = path.basename(lowerPath);
    
    // Test files
    if (lowerPath.includes('/test/') || 
        lowerPath.includes('/tests/') || 
        lowerPath.includes('/__tests__/') ||
        basename.includes('.test.') ||
        basename.includes('.spec.') ||
        basename.includes('_test.')) {
        return 'test';
    }
    
    // Documentation files
    const docExtensions = ['.md', '.txt', '.rst', '.adoc', '.asciidoc'];
    const ext = path.extname(lowerPath);
    if (docExtensions.includes(ext) || 
        lowerPath.includes('/docs/') || 
        lowerPath.includes('/documentation/')) {
        return 'doc';
    }
    
    // Config files
    const configPatterns = [
        'package.json', 'tsconfig.json', 'webpack.config', 
        '.eslintrc', '.prettierrc', 'jest.config', 'vite.config',
        '.yaml', '.yml', '.json', '.toml', '.ini'
    ];
    if (configPatterns.some(p => basename.includes(p))) {
        return 'config';
    }
    
    // Default to source
    return 'source';
}
