/**
 * Relevance Scorer for Auto AI Discovery
 * 
 * Scores discovery results using a hybrid approach:
 * 1. Keyword scoring (always available)
 * 2. AI scoring (when Copilot is available) - blended with keyword scoring
 */

import * as path from 'path';
import {
    RawSearchResult,
    DiscoveryResult,
    RelevanceScoringConfig,
    DEFAULT_SCORING_CONFIG
} from './types';
import { calculateKeywordMatchScore } from './keyword-extractor';

/**
 * Scoring weights for different match types
 */
const SCORING_WEIGHTS = {
    /** File name contains keyword */
    fileNameMatch: 30,
    /** File path contains keyword */
    pathMatch: 20,
    /** File content contains keyword (per match, max 30) */
    contentMatchPerHit: 5,
    contentMatchMax: 30,
    /** Commit message contains keyword */
    commitMessageMatch: 25,
    /** Commit touches relevant file */
    commitFileMatch: 15,
    /** File is in a relevant directory (docs, src, etc.) */
    relevantDirectoryBonus: 10,
    /** File has a descriptive name */
    descriptiveNameBonus: 5
};

/**
 * Directories that indicate relevance
 */
const RELEVANT_DIRECTORIES = new Set([
    'src',
    'lib',
    'core',
    'components',
    'services',
    'utils',
    'helpers',
    'modules',
    'features',
    'api',
    'docs',
    'documentation'
]);

/**
 * Score and rank discovery results
 * @param rawResults Raw search results from providers
 * @param keywords Keywords used for searching
 * @param featureDescription Original feature description
 * @param config Scoring configuration
 * @returns Scored and ranked discovery results
 */
export async function scoreResults(
    rawResults: RawSearchResult[],
    keywords: string[],
    featureDescription: string,
    config: RelevanceScoringConfig = DEFAULT_SCORING_CONFIG
): Promise<DiscoveryResult[]> {
    const scoredResults: DiscoveryResult[] = [];
    
    for (const raw of rawResults) {
        const scored = scoreResult(raw, keywords, featureDescription);
        
        // Only include results above minimum score
        if (scored.relevanceScore >= config.minScore) {
            scoredResults.push(scored);
        }
    }
    
    // Sort by relevance score (descending)
    scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    
    // Limit results
    return scoredResults.slice(0, config.maxResults);
}

/**
 * Score a single result
 */
function scoreResult(
    raw: RawSearchResult,
    keywords: string[],
    featureDescription: string
): DiscoveryResult {
    let score = 0;
    const matchedKeywords: string[] = [];
    const reasons: string[] = [];
    
    // Score based on type
    if (raw.type === 'commit' && raw.commit) {
        const commitScore = scoreCommit(raw, keywords);
        score += commitScore.score;
        matchedKeywords.push(...commitScore.matchedKeywords);
        reasons.push(...commitScore.reasons);
    } else if (raw.path) {
        const fileScore = scoreFile(raw, keywords);
        score += fileScore.score;
        matchedKeywords.push(...fileScore.matchedKeywords);
        reasons.push(...fileScore.reasons);
    }
    
    // Normalize score to 0-100
    score = Math.min(Math.max(score, 0), 100);
    
    // Generate relevance reason
    const relevanceReason = reasons.length > 0
        ? reasons.join('; ')
        : 'Matched search criteria';
    
    // Generate unique ID
    const id = generateResultId(raw);
    
    return {
        id,
        type: raw.type,
        name: raw.name,
        path: raw.path,
        commit: raw.commit,
        relevanceScore: Math.round(score),
        matchedKeywords: [...new Set(matchedKeywords)],
        relevanceReason,
        selected: false
    };
}

/**
 * Score a file result
 */
function scoreFile(
    raw: RawSearchResult,
    keywords: string[]
): { score: number; matchedKeywords: string[]; reasons: string[] } {
    let score = 0;
    const matchedKeywords: string[] = [];
    const reasons: string[] = [];
    
    if (!raw.path) {
        return { score: 0, matchedKeywords: [], reasons: [] };
    }
    
    const fileName = path.basename(raw.path).toLowerCase();
    const filePath = raw.path.toLowerCase();
    const dirName = path.dirname(raw.path).split(path.sep).pop()?.toLowerCase() || '';
    
    // Check file name matches
    for (const keyword of keywords) {
        const lowerKeyword = keyword.toLowerCase();
        
        if (fileName.includes(lowerKeyword)) {
            score += SCORING_WEIGHTS.fileNameMatch;
            matchedKeywords.push(keyword);
            reasons.push(`File name contains "${keyword}"`);
        } else if (filePath.includes(lowerKeyword)) {
            score += SCORING_WEIGHTS.pathMatch;
            matchedKeywords.push(keyword);
            reasons.push(`Path contains "${keyword}"`);
        }
    }
    
    // Check content matches
    if (raw.contentSnippet) {
        const contentResult = calculateKeywordMatchScore(raw.contentSnippet, keywords);
        const contentScore = Math.min(
            contentResult.score,
            SCORING_WEIGHTS.contentMatchMax
        );
        score += contentScore;
        matchedKeywords.push(...contentResult.matchedKeywords);
        
        if (contentResult.matchedKeywords.length > 0) {
            reasons.push(`Content matches: ${contentResult.matchedKeywords.join(', ')}`);
        }
    }
    
    // Bonus for relevant directories
    if (RELEVANT_DIRECTORIES.has(dirName)) {
        score += SCORING_WEIGHTS.relevantDirectoryBonus;
    }
    
    // Bonus for descriptive file names
    if (hasDescriptiveName(fileName)) {
        score += SCORING_WEIGHTS.descriptiveNameBonus;
    }
    
    return { score, matchedKeywords, reasons };
}

/**
 * Score a commit result
 */
function scoreCommit(
    raw: RawSearchResult,
    keywords: string[]
): { score: number; matchedKeywords: string[]; reasons: string[] } {
    let score = 0;
    const matchedKeywords: string[] = [];
    const reasons: string[] = [];
    
    if (!raw.commit) {
        return { score: 0, matchedKeywords: [], reasons: [] };
    }
    
    const subject = raw.commit.subject.toLowerCase();
    
    // Check commit message matches
    for (const keyword of keywords) {
        const lowerKeyword = keyword.toLowerCase();
        
        if (subject.includes(lowerKeyword)) {
            score += SCORING_WEIGHTS.commitMessageMatch;
            matchedKeywords.push(keyword);
            reasons.push(`Commit message contains "${keyword}"`);
        }
    }
    
    // Use content snippet (commit diff stats) for additional matching
    if (raw.contentSnippet) {
        const contentResult = calculateKeywordMatchScore(raw.contentSnippet, keywords);
        score += Math.min(contentResult.score / 2, 20); // Lower weight for diff content
        matchedKeywords.push(...contentResult.matchedKeywords);
    }
    
    return { score, matchedKeywords, reasons };
}

/**
 * Check if a file name is descriptive (not generic like 'index', 'utils', etc.)
 */
function hasDescriptiveName(fileName: string): boolean {
    const genericNames = new Set([
        'index',
        'main',
        'app',
        'utils',
        'helpers',
        'constants',
        'types',
        'config',
        'settings',
        'common',
        'shared',
        'base',
        'core'
    ]);
    
    const baseName = fileName.replace(/\.[^.]+$/, '').toLowerCase();
    return !genericNames.has(baseName) && baseName.length > 3;
}

/**
 * Generate a unique ID for a result
 */
function generateResultId(raw: RawSearchResult): string {
    if (raw.commit) {
        return `commit:${raw.commit.hash}`;
    }
    if (raw.path) {
        return `file:${raw.path}`;
    }
    return `result:${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Deduplicate results by ID
 */
export function deduplicateResults(results: DiscoveryResult[]): DiscoveryResult[] {
    const seen = new Map<string, DiscoveryResult>();
    
    for (const result of results) {
        const existing = seen.get(result.id);
        
        if (!existing || result.relevanceScore > existing.relevanceScore) {
            seen.set(result.id, result);
        }
    }
    
    return Array.from(seen.values());
}

/**
 * Group results by type
 */
export function groupResultsByType(
    results: DiscoveryResult[]
): Map<string, DiscoveryResult[]> {
    const grouped = new Map<string, DiscoveryResult[]>();
    
    for (const result of results) {
        const group = grouped.get(result.type) || [];
        group.push(result);
        grouped.set(result.type, group);
    }
    
    return grouped;
}

/**
 * Filter results by minimum score
 */
export function filterByScore(
    results: DiscoveryResult[],
    minScore: number
): DiscoveryResult[] {
    return results.filter(r => r.relevanceScore >= minScore);
}

/**
 * Get relevance level label based on score
 */
export function getRelevanceLevel(score: number): 'high' | 'medium' | 'low' {
    if (score >= 70) return 'high';
    if (score >= 40) return 'medium';
    return 'low';
}

