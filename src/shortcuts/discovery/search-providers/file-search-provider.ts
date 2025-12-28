/**
 * File Search Provider for Auto AI Discovery
 * 
 * Searches for files matching keywords using:
 * - File name matching
 * - File content matching (for smaller files)
 * - Path matching
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { RawSearchResult, DiscoveryScope, DiscoverySourceType } from '../types';
import { ISearchProvider, getFileCategory, shouldIncludeFile } from './types';

/**
 * Maximum file size to read for content matching (in bytes)
 */
const MAX_FILE_SIZE_FOR_CONTENT = 100 * 1024; // 100KB

/**
 * Maximum number of files to search
 */
const MAX_FILES_TO_SEARCH = 1000;

/**
 * File search provider implementation
 */
export class FileSearchProvider implements ISearchProvider {
    /**
     * Search for files matching the given keywords
     */
    async search(
        keywords: string[],
        scope: DiscoveryScope,
        repositoryRoot: string
    ): Promise<RawSearchResult[]> {
        const results: RawSearchResult[] = [];
        
        try {
            // Build glob pattern based on scope
            const includePatterns = this.buildIncludePatterns(scope);
            const excludePatterns = this.buildExcludePatterns(scope);
            
            // Use VS Code's findFiles API for efficient file discovery
            const files = await this.findFiles(
                repositoryRoot,
                includePatterns,
                excludePatterns
            );
            
            // Search each file
            for (const file of files) {
                const result = await this.searchFile(file, keywords, repositoryRoot);
                if (result) {
                    results.push(result);
                }
                
                // Limit results
                if (results.length >= MAX_FILES_TO_SEARCH) {
                    break;
                }
            }
        } catch (error) {
            console.error('Error in file search:', error);
        }
        
        return results;
    }
    
    /**
     * Build include patterns based on scope
     */
    private buildIncludePatterns(scope: DiscoveryScope): string {
        const patterns: string[] = [];
        
        if (scope.includeSourceFiles) {
            patterns.push(
                '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
                '**/*.py', '**/*.java', '**/*.kt', '**/*.go',
                '**/*.rs', '**/*.rb', '**/*.php', '**/*.cs',
                '**/*.cpp', '**/*.c', '**/*.h', '**/*.swift',
                '**/*.vue', '**/*.svelte'
            );
        }
        
        if (scope.includeDocs) {
            patterns.push(
                '**/*.md', '**/*.mdx', '**/*.txt', '**/*.rst',
                '**/README*', '**/CHANGELOG*', '**/LICENSE*',
                '**/docs/**/*'
            );
        }
        
        if (scope.includeConfigFiles) {
            patterns.push(
                '**/package.json', '**/tsconfig.json', '**/webpack.config.*',
                '**/*.yaml', '**/*.yml', '**/*.toml', '**/*.json',
                '**/Dockerfile', '**/docker-compose.*', '**/Makefile'
            );
        }
        
        return patterns.length > 0 ? `{${patterns.join(',')}}` : '**/*';
    }
    
    /**
     * Build exclude patterns based on scope
     */
    private buildExcludePatterns(scope: DiscoveryScope): string {
        const patterns = [
            ...scope.excludePatterns,
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/out/**',
            '**/build/**',
            '**/.next/**',
            '**/.nuxt/**',
            '**/coverage/**',
            '**/__pycache__/**',
            '**/.pytest_cache/**',
            '**/target/**',
            '**/vendor/**'
        ];
        
        return `{${patterns.join(',')}}`;
    }
    
    /**
     * Find files using VS Code's workspace API
     */
    private async findFiles(
        repositoryRoot: string,
        includePattern: string,
        excludePattern: string
    ): Promise<vscode.Uri[]> {
        try {
            const relativePattern = new vscode.RelativePattern(
                vscode.Uri.file(repositoryRoot),
                includePattern
            );
            
            const files = await vscode.workspace.findFiles(
                relativePattern,
                excludePattern,
                MAX_FILES_TO_SEARCH
            );
            
            return files;
        } catch (error) {
            console.error('Error finding files:', error);
            return [];
        }
    }
    
    /**
     * Search a single file for keyword matches
     */
    private async searchFile(
        fileUri: vscode.Uri,
        keywords: string[],
        repositoryRoot: string
    ): Promise<RawSearchResult | null> {
        try {
            const filePath = fileUri.fsPath;
            const fileName = path.basename(filePath);
            const relativePath = path.relative(repositoryRoot, filePath);
            
            // Check file name and path for keyword matches
            const nameMatches = this.matchesKeywords(fileName, keywords);
            const pathMatches = this.matchesKeywords(relativePath, keywords);
            
            // Read file content for matching (if file is small enough)
            let contentSnippet: string | undefined;
            let contentMatches = false;
            
            try {
                const stat = await fs.promises.stat(filePath);
                if (stat.size <= MAX_FILE_SIZE_FOR_CONTENT) {
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    contentMatches = this.matchesKeywords(content, keywords);
                    
                    if (contentMatches) {
                        // Extract a relevant snippet
                        contentSnippet = this.extractRelevantSnippet(content, keywords);
                    }
                }
            } catch {
                // Ignore read errors (binary files, permission issues, etc.)
            }
            
            // Only return if there's at least one match
            if (!nameMatches && !pathMatches && !contentMatches) {
                return null;
            }
            
            // Determine the type based on file category
            const category = getFileCategory(fileName);
            const type: DiscoverySourceType = category === 'doc' ? 'doc' : 'file';
            
            return {
                type,
                name: fileName,
                path: filePath,
                contentSnippet
            };
        } catch (error) {
            console.error(`Error searching file ${fileUri.fsPath}:`, error);
            return null;
        }
    }
    
    /**
     * Check if text matches any of the keywords
     */
    private matchesKeywords(text: string, keywords: string[]): boolean {
        const lowerText = text.toLowerCase();
        return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
    }
    
    /**
     * Extract a relevant snippet from content that contains keywords
     */
    private extractRelevantSnippet(content: string, keywords: string[]): string {
        const lines = content.split('\n');
        const matchingLines: string[] = [];
        
        for (let i = 0; i < lines.length && matchingLines.length < 5; i++) {
            const line = lines[i];
            if (this.matchesKeywords(line, keywords)) {
                // Include some context
                const start = Math.max(0, i - 1);
                const end = Math.min(lines.length, i + 2);
                const context = lines.slice(start, end).join('\n');
                matchingLines.push(context);
            }
        }
        
        const snippet = matchingLines.join('\n...\n');
        
        // Limit snippet length
        if (snippet.length > 500) {
            return snippet.substring(0, 500) + '...';
        }
        
        return snippet;
    }
}

