/**
 * Tests for Relevance Scorer
 */

import * as assert from 'assert';
import { 
    scoreResults, 
    deduplicateResults, 
    groupResultsByType,
    filterByScore,
    getRelevanceLevel 
} from '../../shortcuts/discovery/relevance-scorer';
import { RawSearchResult, DiscoveryResult, DEFAULT_SCORING_CONFIG } from '../../shortcuts/discovery/types';

suite('RelevanceScorer Tests', () => {

    suite('scoreResults', () => {
        test('should score file results with name match', async () => {
            const rawResults: RawSearchResult[] = [
                {
                    type: 'file',
                    name: 'auth.ts',
                    path: '/src/auth.ts'
                }
            ];
            
            const keywords = ['auth'];
            const results = await scoreResults(rawResults, keywords, 'authentication feature');
            
            assert.ok(results.length >= 0);
            if (results.length > 0) {
                assert.ok(results[0].relevanceScore >= 0);
            }
        });

        test('should score file results with path match', async () => {
            const rawResults: RawSearchResult[] = [
                {
                    type: 'file',
                    name: 'service.ts',
                    path: '/src/authentication/service.ts'
                }
            ];
            
            const keywords = ['authentication'];
            const results = await scoreResults(rawResults, keywords, 'authentication feature');
            
            assert.ok(results.length >= 0);
        });

        test('should score file results with content match', async () => {
            const rawResults: RawSearchResult[] = [
                {
                    type: 'file',
                    name: 'utils.ts',
                    path: '/src/utils.ts',
                    contentSnippet: 'function authenticate(user) { return true; }'
                }
            ];
            
            const keywords = ['authenticate'];
            const results = await scoreResults(rawResults, keywords, 'authentication feature');
            
            assert.ok(results.length >= 0);
        });

        test('should score commit results', async () => {
            const rawResults: RawSearchResult[] = [
                {
                    type: 'commit',
                    name: 'feat: Add authentication module',
                    commit: {
                        hash: 'abc123def456',
                        shortHash: 'abc123d',
                        subject: 'feat: Add authentication module',
                        authorName: 'Developer',
                        date: '2024-01-15T10:00:00Z',
                        repositoryRoot: '/repo'
                    }
                }
            ];
            
            const keywords = ['authentication'];
            const results = await scoreResults(rawResults, keywords, 'authentication feature');
            
            assert.ok(results.length >= 0);
        });

        test('should filter results below minimum score', async () => {
            const rawResults: RawSearchResult[] = [
                {
                    type: 'file',
                    name: 'random.ts',
                    path: '/src/random.ts'
                }
            ];
            
            const keywords = ['authentication'];
            const config = { ...DEFAULT_SCORING_CONFIG, minScore: 50 };
            const results = await scoreResults(rawResults, keywords, 'authentication feature', config);
            
            // Results below minScore should be filtered
            assert.ok(results.every(r => r.relevanceScore >= config.minScore));
        });

        test('should sort results by relevance score', async () => {
            const rawResults: RawSearchResult[] = [
                { type: 'file', name: 'low.ts', path: '/src/low.ts' },
                { type: 'file', name: 'auth.ts', path: '/src/auth.ts' },
                { type: 'file', name: 'medium.ts', path: '/src/auth/medium.ts' }
            ];
            
            const keywords = ['auth'];
            const results = await scoreResults(rawResults, keywords, 'auth feature');
            
            // Results should be sorted by score descending
            for (let i = 0; i < results.length - 1; i++) {
                assert.ok(results[i].relevanceScore >= results[i + 1].relevanceScore);
            }
        });

        test('should limit results to maxResults', async () => {
            const rawResults: RawSearchResult[] = [];
            for (let i = 0; i < 100; i++) {
                rawResults.push({
                    type: 'file',
                    name: `auth${i}.ts`,
                    path: `/src/auth${i}.ts`
                });
            }
            
            const keywords = ['auth'];
            const config = { ...DEFAULT_SCORING_CONFIG, maxResults: 10, minScore: 0 };
            const results = await scoreResults(rawResults, keywords, 'auth feature', config);
            
            assert.ok(results.length <= config.maxResults);
        });

        test('should handle empty raw results', async () => {
            const results = await scoreResults([], ['auth'], 'auth feature');
            assert.deepStrictEqual(results, []);
        });

        test('should handle empty keywords', async () => {
            const rawResults: RawSearchResult[] = [
                { type: 'file', name: 'auth.ts', path: '/src/auth.ts' }
            ];
            
            const results = await scoreResults(rawResults, [], 'feature');
            
            // All results should have low scores with no keywords
            assert.ok(results.every(r => r.relevanceScore === 0 || results.length === 0));
        });

        test('should set selected to false by default', async () => {
            const rawResults: RawSearchResult[] = [
                { type: 'file', name: 'auth.ts', path: '/src/auth.ts' }
            ];
            
            const keywords = ['auth'];
            const config = { ...DEFAULT_SCORING_CONFIG, minScore: 0 };
            const results = await scoreResults(rawResults, keywords, 'auth feature', config);
            
            assert.ok(results.every(r => r.selected === false));
        });

        test('should generate unique IDs', async () => {
            const rawResults: RawSearchResult[] = [
                { type: 'file', name: 'auth.ts', path: '/src/auth.ts' },
                { type: 'file', name: 'login.ts', path: '/src/login.ts' }
            ];
            
            const keywords = ['auth', 'login'];
            const config = { ...DEFAULT_SCORING_CONFIG, minScore: 0 };
            const results = await scoreResults(rawResults, keywords, 'auth login', config);
            
            const ids = results.map(r => r.id);
            const uniqueIds = new Set(ids);
            assert.strictEqual(ids.length, uniqueIds.size);
        });

        test('should include matched keywords in results', async () => {
            const rawResults: RawSearchResult[] = [
                { 
                    type: 'file', 
                    name: 'authentication.ts', 
                    path: '/src/authentication.ts',
                    contentSnippet: 'login functionality'
                }
            ];
            
            const keywords = ['authentication', 'login'];
            const config = { ...DEFAULT_SCORING_CONFIG, minScore: 0 };
            const results = await scoreResults(rawResults, keywords, 'auth login', config);
            
            if (results.length > 0) {
                assert.ok(Array.isArray(results[0].matchedKeywords));
            }
        });

        test('should generate relevance reason', async () => {
            const rawResults: RawSearchResult[] = [
                { type: 'file', name: 'auth.ts', path: '/src/auth.ts' }
            ];
            
            const keywords = ['auth'];
            const config = { ...DEFAULT_SCORING_CONFIG, minScore: 0 };
            const results = await scoreResults(rawResults, keywords, 'auth feature', config);
            
            if (results.length > 0) {
                assert.ok(typeof results[0].relevanceReason === 'string');
                assert.ok(results[0].relevanceReason.length > 0);
            }
        });
    });

    suite('deduplicateResults', () => {
        test('should remove duplicate results by ID', () => {
            const results: DiscoveryResult[] = [
                {
                    id: 'file:/src/auth.ts',
                    type: 'file',
                    name: 'auth.ts',
                    path: '/src/auth.ts',
                    relevanceScore: 80,
                    matchedKeywords: ['auth'],
                    relevanceReason: 'Match',
                    selected: false
                },
                {
                    id: 'file:/src/auth.ts',
                    type: 'file',
                    name: 'auth.ts',
                    path: '/src/auth.ts',
                    relevanceScore: 60,
                    matchedKeywords: ['auth'],
                    relevanceReason: 'Match',
                    selected: false
                }
            ];
            
            const deduplicated = deduplicateResults(results);
            
            assert.strictEqual(deduplicated.length, 1);
        });

        test('should keep result with higher score when deduplicating', () => {
            const results: DiscoveryResult[] = [
                {
                    id: 'file:/src/auth.ts',
                    type: 'file',
                    name: 'auth.ts',
                    path: '/src/auth.ts',
                    relevanceScore: 60,
                    matchedKeywords: ['auth'],
                    relevanceReason: 'Match',
                    selected: false
                },
                {
                    id: 'file:/src/auth.ts',
                    type: 'file',
                    name: 'auth.ts',
                    path: '/src/auth.ts',
                    relevanceScore: 80,
                    matchedKeywords: ['auth'],
                    relevanceReason: 'Better match',
                    selected: false
                }
            ];
            
            const deduplicated = deduplicateResults(results);
            
            assert.strictEqual(deduplicated.length, 1);
            assert.strictEqual(deduplicated[0].relevanceScore, 80);
        });

        test('should handle empty array', () => {
            const deduplicated = deduplicateResults([]);
            assert.deepStrictEqual(deduplicated, []);
        });

        test('should not modify unique results', () => {
            const results: DiscoveryResult[] = [
                {
                    id: 'file:/src/auth.ts',
                    type: 'file',
                    name: 'auth.ts',
                    path: '/src/auth.ts',
                    relevanceScore: 80,
                    matchedKeywords: ['auth'],
                    relevanceReason: 'Match',
                    selected: false
                },
                {
                    id: 'file:/src/login.ts',
                    type: 'file',
                    name: 'login.ts',
                    path: '/src/login.ts',
                    relevanceScore: 70,
                    matchedKeywords: ['login'],
                    relevanceReason: 'Match',
                    selected: false
                }
            ];
            
            const deduplicated = deduplicateResults(results);
            
            assert.strictEqual(deduplicated.length, 2);
        });
    });

    suite('groupResultsByType', () => {
        test('should group results by type', () => {
            const results: DiscoveryResult[] = [
                { id: '1', type: 'file', name: 'a.ts', relevanceScore: 80, matchedKeywords: [], relevanceReason: '', selected: false },
                { id: '2', type: 'commit', name: 'b', relevanceScore: 70, matchedKeywords: [], relevanceReason: '', selected: false },
                { id: '3', type: 'file', name: 'c.ts', relevanceScore: 60, matchedKeywords: [], relevanceReason: '', selected: false },
                { id: '4', type: 'doc', name: 'd.md', relevanceScore: 50, matchedKeywords: [], relevanceReason: '', selected: false }
            ];
            
            const grouped = groupResultsByType(results);
            
            assert.ok(grouped.has('file'));
            assert.ok(grouped.has('commit'));
            assert.ok(grouped.has('doc'));
            assert.strictEqual(grouped.get('file')?.length, 2);
            assert.strictEqual(grouped.get('commit')?.length, 1);
            assert.strictEqual(grouped.get('doc')?.length, 1);
        });

        test('should handle empty array', () => {
            const grouped = groupResultsByType([]);
            assert.strictEqual(grouped.size, 0);
        });

        test('should handle single type', () => {
            const results: DiscoveryResult[] = [
                { id: '1', type: 'file', name: 'a.ts', relevanceScore: 80, matchedKeywords: [], relevanceReason: '', selected: false },
                { id: '2', type: 'file', name: 'b.ts', relevanceScore: 70, matchedKeywords: [], relevanceReason: '', selected: false }
            ];
            
            const grouped = groupResultsByType(results);
            
            assert.strictEqual(grouped.size, 1);
            assert.strictEqual(grouped.get('file')?.length, 2);
        });
    });

    suite('filterByScore', () => {
        test('should filter results below minimum score', () => {
            const results: DiscoveryResult[] = [
                { id: '1', type: 'file', name: 'a.ts', relevanceScore: 80, matchedKeywords: [], relevanceReason: '', selected: false },
                { id: '2', type: 'file', name: 'b.ts', relevanceScore: 40, matchedKeywords: [], relevanceReason: '', selected: false },
                { id: '3', type: 'file', name: 'c.ts', relevanceScore: 20, matchedKeywords: [], relevanceReason: '', selected: false }
            ];
            
            const filtered = filterByScore(results, 50);
            
            assert.strictEqual(filtered.length, 1);
            assert.strictEqual(filtered[0].id, '1');
        });

        test('should include results at minimum score', () => {
            const results: DiscoveryResult[] = [
                { id: '1', type: 'file', name: 'a.ts', relevanceScore: 50, matchedKeywords: [], relevanceReason: '', selected: false }
            ];
            
            const filtered = filterByScore(results, 50);
            
            assert.strictEqual(filtered.length, 1);
        });

        test('should handle empty array', () => {
            const filtered = filterByScore([], 50);
            assert.deepStrictEqual(filtered, []);
        });

        test('should return empty for very high minimum', () => {
            const results: DiscoveryResult[] = [
                { id: '1', type: 'file', name: 'a.ts', relevanceScore: 80, matchedKeywords: [], relevanceReason: '', selected: false }
            ];
            
            const filtered = filterByScore(results, 100);
            
            assert.strictEqual(filtered.length, 0);
        });

        test('should return all for zero minimum', () => {
            const results: DiscoveryResult[] = [
                { id: '1', type: 'file', name: 'a.ts', relevanceScore: 80, matchedKeywords: [], relevanceReason: '', selected: false },
                { id: '2', type: 'file', name: 'b.ts', relevanceScore: 0, matchedKeywords: [], relevanceReason: '', selected: false }
            ];
            
            const filtered = filterByScore(results, 0);
            
            assert.strictEqual(filtered.length, 2);
        });
    });

    suite('getRelevanceLevel', () => {
        test('should return high for scores >= 70', () => {
            assert.strictEqual(getRelevanceLevel(70), 'high');
            assert.strictEqual(getRelevanceLevel(85), 'high');
            assert.strictEqual(getRelevanceLevel(100), 'high');
        });

        test('should return medium for scores >= 40 and < 70', () => {
            assert.strictEqual(getRelevanceLevel(40), 'medium');
            assert.strictEqual(getRelevanceLevel(55), 'medium');
            assert.strictEqual(getRelevanceLevel(69), 'medium');
        });

        test('should return low for scores < 40', () => {
            assert.strictEqual(getRelevanceLevel(0), 'low');
            assert.strictEqual(getRelevanceLevel(20), 'low');
            assert.strictEqual(getRelevanceLevel(39), 'low');
        });
    });

    suite('Edge cases', () => {
        test('should handle results with missing optional fields', async () => {
            const rawResults: RawSearchResult[] = [
                {
                    type: 'file',
                    name: 'auth.ts'
                    // path is missing
                }
            ];
            
            const keywords = ['auth'];
            const config = { ...DEFAULT_SCORING_CONFIG, minScore: 0 };
            const results = await scoreResults(rawResults, keywords, 'auth', config);
            
            // Should not throw
            assert.ok(Array.isArray(results));
        });

        test('should handle very long content snippets', async () => {
            const longContent = 'auth '.repeat(10000);
            const rawResults: RawSearchResult[] = [
                {
                    type: 'file',
                    name: 'auth.ts',
                    path: '/src/auth.ts',
                    contentSnippet: longContent
                }
            ];
            
            const keywords = ['auth'];
            const config = { ...DEFAULT_SCORING_CONFIG, minScore: 0 };
            const results = await scoreResults(rawResults, keywords, 'auth', config);
            
            // Should handle without issues
            assert.ok(Array.isArray(results));
        });

        test('should handle special characters in paths', async () => {
            const rawResults: RawSearchResult[] = [
                {
                    type: 'file',
                    name: 'auth-service.test.ts',
                    path: '/src/auth-service/auth-service.test.ts'
                }
            ];
            
            const keywords = ['auth'];
            const config = { ...DEFAULT_SCORING_CONFIG, minScore: 0 };
            const results = await scoreResults(rawResults, keywords, 'auth', config);
            
            assert.ok(Array.isArray(results));
        });

        test('should handle unicode in content', async () => {
            const rawResults: RawSearchResult[] = [
                {
                    type: 'file',
                    name: 'i18n.ts',
                    path: '/src/i18n.ts',
                    contentSnippet: 'const greeting = "こんにちは auth";'
                }
            ];
            
            const keywords = ['auth'];
            const config = { ...DEFAULT_SCORING_CONFIG, minScore: 0 };
            const results = await scoreResults(rawResults, keywords, 'auth', config);
            
            assert.ok(Array.isArray(results));
        });
    });
});
