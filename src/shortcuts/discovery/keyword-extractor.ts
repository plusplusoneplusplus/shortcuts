/**
 * Keyword Extractor for Auto AI Discovery
 * 
 * Extracts relevant keywords from a feature description using:
 * 1. AI (Copilot) when available - for better semantic understanding
 * 2. Simple NLP fallback - split, remove stop words, extract key terms
 */

import { KeywordExtractionResult } from './types';

/**
 * Common English stop words to filter out
 */
const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
    'used', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
    'she', 'we', 'they', 'what', 'which', 'who', 'whom', 'when', 'where',
    'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'not', 'only', 'same', 'so', 'than',
    'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then', 'once',
    'if', 'unless', 'while', 'although', 'because', 'since', 'until',
    'before', 'after', 'above', 'below', 'between', 'into', 'through',
    'during', 'out', 'off', 'over', 'under', 'again', 'further',
    'about', 'up', 'down', 'any', 'own', 'being', 'able', 'want', 'wants',
    'wanted', 'like', 'likes', 'liked', 'using', 'use', 'uses', 'make',
    'makes', 'made', 'get', 'gets', 'got', 'getting', 'add', 'adds', 'added',
    'implement', 'implements', 'implemented', 'implementing', 'create',
    'creates', 'created', 'creating', 'feature', 'features', 'functionality',
    'function', 'method', 'methods', 'class', 'classes', 'file', 'files',
    'code', 'coding', 'program', 'programming', 'software', 'application',
    'system', 'systems', 'data', 'information', 'process', 'processing'
]);

/**
 * Programming-related terms that should be kept even if they look like stop words
 */
const KEEP_TERMS = new Set([
    'api', 'ui', 'ux', 'db', 'sql', 'css', 'html', 'json', 'xml', 'yaml',
    'http', 'https', 'rest', 'graphql', 'grpc', 'tcp', 'udp', 'websocket',
    'auth', 'oauth', 'jwt', 'token', 'session', 'cookie', 'cache', 'redis',
    'queue', 'worker', 'job', 'task', 'cron', 'scheduler', 'event', 'handler',
    'middleware', 'router', 'controller', 'service', 'repository', 'model',
    'view', 'component', 'module', 'package', 'library', 'framework', 'sdk',
    'cli', 'gui', 'tui', 'repl', 'shell', 'terminal', 'console', 'log',
    'debug', 'test', 'spec', 'mock', 'stub', 'fixture', 'snapshot', 'e2e',
    'unit', 'integration', 'regression', 'performance', 'benchmark', 'load',
    'stress', 'security', 'vulnerability', 'exploit', 'patch', 'hotfix',
    'release', 'deploy', 'ci', 'cd', 'pipeline', 'build', 'compile', 'bundle',
    'minify', 'uglify', 'lint', 'format', 'prettier', 'eslint', 'tslint',
    'webpack', 'rollup', 'vite', 'parcel', 'esbuild', 'swc', 'babel',
    'typescript', 'javascript', 'python', 'java', 'kotlin', 'swift', 'rust',
    'go', 'golang', 'ruby', 'php', 'csharp', 'dotnet', 'node', 'nodejs',
    'deno', 'bun', 'react', 'vue', 'angular', 'svelte', 'solid', 'preact',
    'next', 'nuxt', 'gatsby', 'remix', 'astro', 'express', 'fastify', 'koa',
    'nest', 'django', 'flask', 'fastapi', 'spring', 'rails', 'laravel',
    'docker', 'kubernetes', 'k8s', 'helm', 'terraform', 'ansible', 'vagrant',
    'aws', 'azure', 'gcp', 'cloud', 'serverless', 'lambda', 'function',
    'storage', 's3', 'blob', 'bucket', 'cdn', 'edge', 'proxy', 'gateway',
    'load', 'balancer', 'scaling', 'autoscale', 'replica', 'shard', 'cluster',
    'node', 'pod', 'container', 'image', 'registry', 'artifact', 'binary',
    'git', 'github', 'gitlab', 'bitbucket', 'svn', 'mercurial', 'vcs',
    'branch', 'merge', 'rebase', 'cherry', 'pick', 'stash', 'commit', 'push',
    'pull', 'fetch', 'clone', 'fork', 'pr', 'mr', 'review', 'approve',
    'database', 'mysql', 'postgres', 'postgresql', 'mongodb', 'dynamodb',
    'cassandra', 'elasticsearch', 'solr', 'lucene', 'sqlite', 'oracle',
    'mssql', 'mariadb', 'cockroach', 'timescale', 'influx', 'prometheus',
    'grafana', 'kibana', 'splunk', 'datadog', 'newrelic', 'sentry', 'bugsnag'
]);

/**
 * Extract keywords from a feature description
 * @param description Natural language description of the feature
 * @param useAI Whether to attempt AI-based extraction (currently not implemented)
 * @returns Extracted keywords and whether AI was used
 */
export function extractKeywords(
    description: string,
    useAI: boolean = false
): KeywordExtractionResult {
    // For now, we only use simple NLP extraction
    // AI extraction can be added later when Copilot API is available
    const keywords = extractKeywordsSimple(description);
    
    return {
        keywords,
        usedAI: false
    };
}

/**
 * Extract keywords using simple NLP techniques
 * @param description Natural language description
 * @returns Array of extracted keywords
 */
function extractKeywordsSimple(description: string): string[] {
    // Normalize the text
    const normalized = description.toLowerCase();
    
    // Split into words (handle camelCase, PascalCase, snake_case, kebab-case)
    const words = splitIntoWords(normalized);
    
    // Filter and deduplicate
    const keywords = new Set<string>();
    
    for (const word of words) {
        // Skip very short words
        if (word.length < 2) continue;
        
        // Keep programming-related terms
        if (KEEP_TERMS.has(word)) {
            keywords.add(word);
            continue;
        }
        
        // Skip stop words
        if (STOP_WORDS.has(word)) continue;
        
        // Skip pure numbers
        if (/^\d+$/.test(word)) continue;
        
        // Add the word
        keywords.add(word);
    }
    
    // Convert to array and sort by relevance (longer words first, then alphabetically)
    return Array.from(keywords).sort((a, b) => {
        if (a.length !== b.length) {
            return b.length - a.length;
        }
        return a.localeCompare(b);
    });
}

/**
 * Split text into words, handling various naming conventions
 * @param text Text to split
 * @returns Array of words
 */
function splitIntoWords(text: string): string[] {
    const words: string[] = [];
    
    // First, split by common delimiters
    const parts = text.split(/[\s\-_.,;:!?'"()\[\]{}|/\\<>@#$%^&*+=~`]+/);
    
    for (const part of parts) {
        if (!part) continue;
        
        // Handle camelCase and PascalCase
        const camelWords = part.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
        words.push(...camelWords);
    }
    
    return words;
}

/**
 * Combine user-provided keywords with extracted keywords
 * @param extracted Keywords extracted from description
 * @param userProvided Keywords provided by user
 * @returns Combined and deduplicated keywords
 */
export function combineKeywords(
    extracted: string[],
    userProvided?: string[]
): string[] {
    const combined = new Set<string>();
    
    // Add user-provided keywords first (higher priority)
    if (userProvided) {
        for (const keyword of userProvided) {
            const normalized = keyword.toLowerCase().trim();
            if (normalized) {
                combined.add(normalized);
            }
        }
    }
    
    // Add extracted keywords
    for (const keyword of extracted) {
        combined.add(keyword);
    }
    
    return Array.from(combined);
}

/**
 * Generate search patterns from keywords
 * @param keywords Keywords to generate patterns for
 * @returns Array of regex patterns for searching
 */
export function generateSearchPatterns(keywords: string[]): RegExp[] {
    const patterns: RegExp[] = [];
    
    for (const keyword of keywords) {
        // Escape special regex characters
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        // Create case-insensitive pattern with word boundaries
        patterns.push(new RegExp(`\\b${escaped}\\b`, 'gi'));
        
        // Also create a pattern for partial matches (for longer keywords)
        if (keyword.length >= 4) {
            patterns.push(new RegExp(escaped, 'gi'));
        }
    }
    
    return patterns;
}

/**
 * Calculate keyword match score for a piece of text
 * @param text Text to score
 * @param keywords Keywords to match
 * @returns Score based on keyword matches (0-100)
 */
export function calculateKeywordMatchScore(
    text: string,
    keywords: string[]
): { score: number; matchedKeywords: string[] } {
    if (!text || keywords.length === 0) {
        return { score: 0, matchedKeywords: [] };
    }
    
    const normalizedText = text.toLowerCase();
    const matchedKeywords: string[] = [];
    let totalScore = 0;
    
    for (const keyword of keywords) {
        const pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        const matches = normalizedText.match(pattern);
        
        if (matches && matches.length > 0) {
            matchedKeywords.push(keyword);
            
            // Score based on number of matches and keyword length
            const matchScore = Math.min(matches.length * 10, 30);
            const lengthBonus = Math.min(keyword.length * 2, 10);
            totalScore += matchScore + lengthBonus;
        }
    }
    
    // Normalize score to 0-100 range
    const normalizedScore = Math.min(totalScore, 100);
    
    return {
        score: normalizedScore,
        matchedKeywords
    };
}

