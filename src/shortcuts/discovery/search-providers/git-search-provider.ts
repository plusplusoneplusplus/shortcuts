/**
 * Git Search Provider for Auto AI Discovery
 * 
 * Searches git commit history for commits matching keywords using:
 * - Commit message matching (git log --grep)
 * - File path matching (git log -- <paths>)
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { RawSearchResult, DiscoveryScope, DiscoveryCommitInfo } from '../types';
import { ISearchProvider } from './types';

/**
 * Git search provider implementation
 */
export class GitSearchProvider implements ISearchProvider {
    /**
     * Search for commits matching the given keywords
     */
    async search(
        keywords: string[],
        scope: DiscoveryScope,
        repositoryRoot: string
    ): Promise<RawSearchResult[]> {
        if (!scope.includeGitHistory) {
            return [];
        }
        
        const results: RawSearchResult[] = [];
        const seenHashes = new Set<string>();
        
        try {
            // Search by commit message
            const messageResults = await this.searchByMessage(
                keywords,
                scope.maxCommits,
                repositoryRoot
            );
            
            for (const result of messageResults) {
                if (result.commit && !seenHashes.has(result.commit.hash)) {
                    seenHashes.add(result.commit.hash);
                    results.push(result);
                }
            }
            
            // If we have file paths from file search, also search by paths
            // This is handled separately by the discovery engine
            
        } catch (error) {
            console.error('Error in git search:', error);
        }
        
        return results;
    }
    
    /**
     * Search commits by message content
     */
    async searchByMessage(
        keywords: string[],
        maxCommits: number,
        repositoryRoot: string
    ): Promise<RawSearchResult[]> {
        const results: RawSearchResult[] = [];
        
        try {
            for (const keyword of keywords) {
                // Use git log --grep to search commit messages
                const commits = this.searchCommitsByKeyword(
                    keyword,
                    maxCommits,
                    repositoryRoot
                );
                
                for (const commit of commits) {
                    results.push({
                        type: 'commit',
                        name: commit.subject,
                        commit,
                        contentSnippet: commit.subject
                    });
                }
                
                // Stop if we have enough results
                if (results.length >= maxCommits) {
                    break;
                }
            }
        } catch (error) {
            console.error('Error searching commits by message:', error);
        }
        
        return results.slice(0, maxCommits);
    }
    
    /**
     * Search commits that touch specific file paths
     */
    async searchByPaths(
        paths: string[],
        maxCommits: number,
        repositoryRoot: string
    ): Promise<RawSearchResult[]> {
        const results: RawSearchResult[] = [];
        
        try {
            // Make paths relative to repository root
            const relativePaths = paths.map(p => 
                path.isAbsolute(p) ? path.relative(repositoryRoot, p) : p
            );
            
            const commits = this.searchCommitsByPaths(
                relativePaths,
                maxCommits,
                repositoryRoot
            );
            
            for (const commit of commits) {
                results.push({
                    type: 'commit',
                    name: commit.subject,
                    commit,
                    contentSnippet: commit.subject
                });
            }
        } catch (error) {
            console.error('Error searching commits by paths:', error);
        }
        
        return results;
    }
    
    /**
     * Search commits by keyword using git log --grep
     */
    private searchCommitsByKeyword(
        keyword: string,
        maxCount: number,
        repositoryRoot: string
    ): DiscoveryCommitInfo[] {
        try {
            // Escape special characters for git grep
            const escapedKeyword = keyword.replace(/['"\\]/g, '\\$&');
            
            // Format: hash|shortHash|subject|authorName|date
            const format = '%H|%h|%s|%an|%aI';
            
            const command = `git log --grep="${escapedKeyword}" -i --pretty=format:"${format}" -n ${maxCount}`;
            
            const output = execSync(command, {
                cwd: repositoryRoot,
                encoding: 'utf-8',
                maxBuffer: 5 * 1024 * 1024, // 5MB buffer
                timeout: 30000,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            if (!output.trim()) {
                return [];
            }
            
            return this.parseCommitOutput(output, repositoryRoot);
        } catch (error) {
            // Git command failed - likely no matches or not a git repo
            return [];
        }
    }
    
    /**
     * Search commits that touch specific paths
     */
    private searchCommitsByPaths(
        paths: string[],
        maxCount: number,
        repositoryRoot: string
    ): DiscoveryCommitInfo[] {
        if (paths.length === 0) {
            return [];
        }
        
        try {
            // Format: hash|shortHash|subject|authorName|date
            const format = '%H|%h|%s|%an|%aI';
            
            // Escape paths for shell
            const escapedPaths = paths.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' ');
            
            const command = `git log --pretty=format:"${format}" -n ${maxCount} -- ${escapedPaths}`;
            
            const output = execSync(command, {
                cwd: repositoryRoot,
                encoding: 'utf-8',
                maxBuffer: 5 * 1024 * 1024,
                timeout: 30000,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            if (!output.trim()) {
                return [];
            }
            
            return this.parseCommitOutput(output, repositoryRoot);
        } catch (error) {
            return [];
        }
    }
    
    /**
     * Parse git log output into commit info objects
     */
    private parseCommitOutput(output: string, repositoryRoot: string): DiscoveryCommitInfo[] {
        const commits: DiscoveryCommitInfo[] = [];
        const lines = output.trim().split('\n');
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            const parts = line.split('|');
            if (parts.length >= 5) {
                commits.push({
                    hash: parts[0],
                    shortHash: parts[1],
                    subject: parts[2],
                    authorName: parts[3],
                    date: parts[4],
                    repositoryRoot
                });
            }
        }
        
        return commits;
    }
    
    /**
     * Get the diff for a specific commit (for content matching)
     */
    getCommitDiff(commitHash: string, repositoryRoot: string): string {
        try {
            const command = `git show --stat ${commitHash}`;
            
            const output = execSync(command, {
                cwd: repositoryRoot,
                encoding: 'utf-8',
                maxBuffer: 5 * 1024 * 1024,
                timeout: 30000,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            return output;
        } catch (error) {
            return '';
        }
    }
    
    /**
     * Check if a path is inside a git repository
     */
    static isGitRepository(repositoryRoot: string): boolean {
        try {
            execSync('git rev-parse --git-dir', {
                cwd: repositoryRoot,
                encoding: 'utf-8',
                timeout: 5000,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            return true;
        } catch {
            return false;
        }
    }
}

