/**
 * Tests for Keyword Extractor
 */

import * as assert from 'assert';
import { 
    extractKeywords, 
    combineKeywords, 
    calculateKeywordMatchScore,
    generateSearchPatterns 
} from '../../shortcuts/discovery/keyword-extractor';

suite('KeywordExtractor Tests', () => {

    suite('extractKeywords', () => {
        test('should extract keywords from simple description', () => {
            const result = extractKeywords('Implement user authentication');
            
            assert.ok(result.keywords.length > 0);
            assert.strictEqual(result.usedAI, false);
        });

        test('should remove stop words', () => {
            const result = extractKeywords('The quick brown fox jumps over the lazy dog');
            
            // Stop words should be removed
            assert.ok(!result.keywords.includes('the'));
            assert.ok(!result.keywords.includes('over'));
            
            // Content words should remain
            assert.ok(result.keywords.includes('quick'));
            assert.ok(result.keywords.includes('brown'));
            assert.ok(result.keywords.includes('fox'));
            assert.ok(result.keywords.includes('jumps'));
            assert.ok(result.keywords.includes('lazy'));
            assert.ok(result.keywords.includes('dog'));
        });

        test('should handle empty string', () => {
            const result = extractKeywords('');
            assert.deepStrictEqual(result.keywords, []);
        });

        test('should handle whitespace only', () => {
            const result = extractKeywords('   \t\n   ');
            assert.deepStrictEqual(result.keywords, []);
        });

        test('should handle only stop words', () => {
            const result = extractKeywords('the and or but with');
            assert.deepStrictEqual(result.keywords, []);
        });

        test('should remove very short words', () => {
            const result = extractKeywords('I am a developer');
            
            assert.ok(!result.keywords.includes('i'));
            assert.ok(!result.keywords.includes('a'));
        });

        test('should convert to lowercase', () => {
            const result = extractKeywords('UPPERCASE Mixed');
            
            assert.ok(result.keywords.includes('uppercase'));
            assert.ok(result.keywords.includes('mixed'));
            
            // Original cases should not exist
            assert.ok(!result.keywords.includes('UPPERCASE'));
            assert.ok(!result.keywords.includes('Mixed'));
        });

        test('should remove duplicates', () => {
            const result = extractKeywords('auth auth authentication auth');
            
            const authCount = result.keywords.filter(k => k === 'auth').length;
            assert.strictEqual(authCount, 1);
        });

        test('should handle punctuation', () => {
            const result = extractKeywords('Hello, world! How are you?');
            
            assert.ok(result.keywords.includes('hello'));
            assert.ok(result.keywords.includes('world'));
            // Punctuation should be stripped
            assert.ok(!result.keywords.includes('hello,'));
            assert.ok(!result.keywords.includes('world!'));
        });

        test('should handle special characters', () => {
            const result = extractKeywords('user@email.com #hashtag $money');
            
            // Should split on special chars and extract words
            assert.ok(result.keywords.includes('user'));
            assert.ok(result.keywords.includes('email'));
            assert.ok(result.keywords.includes('hashtag'));
            assert.ok(result.keywords.includes('money'));
        });

        test('should handle hyphenated words', () => {
            const result = extractKeywords('user-authentication real-time');
            
            // Hyphens should split words
            assert.ok(result.keywords.includes('user'));
            assert.ok(result.keywords.includes('authentication'));
            assert.ok(result.keywords.includes('real'));
            assert.ok(result.keywords.includes('time'));
        });

        test('should handle underscored words', () => {
            const result = extractKeywords('user_service get_data');
            
            assert.ok(result.keywords.includes('user'));
            assert.ok(result.keywords.includes('service'));
            assert.ok(result.keywords.includes('data'));
        });

        test('should keep programming-related terms', () => {
            const result = extractKeywords('JWT authentication with OAuth2 and API tokens');
            
            assert.ok(result.keywords.includes('jwt'));
            assert.ok(result.keywords.includes('authentication'));
            assert.ok(result.keywords.includes('oauth'));
            assert.ok(result.keywords.includes('api'));
            assert.ok(result.keywords.includes('tokens'));
        });

        test('should handle file paths', () => {
            const result = extractKeywords('Update src/components/Auth/LoginForm.tsx');
            
            assert.ok(result.keywords.includes('src'));
            assert.ok(result.keywords.includes('components'));
            assert.ok(result.keywords.includes('auth'));
            assert.ok(result.keywords.includes('login'));
            assert.ok(result.keywords.includes('form'));
            assert.ok(result.keywords.includes('tsx'));
        });

        test('should handle git commit style messages', () => {
            const result = extractKeywords('feat(auth): add password reset functionality');
            
            assert.ok(result.keywords.includes('feat'));
            assert.ok(result.keywords.includes('auth'));
            assert.ok(result.keywords.includes('password'));
            assert.ok(result.keywords.includes('reset'));
        });

        test('should handle long descriptions', () => {
            const longDescription = `
                This is a comprehensive feature that involves implementing 
                user authentication with multiple providers including OAuth2, 
                SAML, and traditional username/password login. The system 
                should support multi-factor authentication, session management, 
                and secure token refresh mechanisms.
            `;
            
            const result = extractKeywords(longDescription);
            
            assert.ok(result.keywords.length > 0);
            assert.ok(result.keywords.includes('authentication'));
            assert.ok(result.keywords.includes('oauth'));
            assert.ok(result.keywords.includes('saml'));
            assert.ok(result.keywords.includes('login'));
            assert.ok(result.keywords.includes('session'));
            assert.ok(result.keywords.includes('token'));
        });

        test('should handle unicode characters', () => {
            const result = extractKeywords('café résumé naïve');
            
            // Should handle accented characters
            assert.ok(result.keywords.length > 0);
        });

        test('should handle mixed content', () => {
            const result = extractKeywords('Fix bug #123 in auth-service v2.0.1 for user@domain.com');
            
            assert.ok(result.keywords.includes('bug'));
            assert.ok(result.keywords.includes('auth'));
            assert.ok(result.keywords.includes('service'));
            assert.ok(result.keywords.includes('user'));
        });

        test('should sort by length (longer words first)', () => {
            const result = extractKeywords('a abc abcdef ab');
            
            // Longer words should come first
            if (result.keywords.length >= 2) {
                assert.ok(result.keywords[0].length >= result.keywords[result.keywords.length - 1].length);
            }
        });
    });

    suite('combineKeywords', () => {
        test('should combine extracted and user-provided keywords', () => {
            const extracted = ['auth', 'login'];
            const userProvided = ['custom', 'keyword'];
            
            const combined = combineKeywords(extracted, userProvided);
            
            // Should include both
            assert.ok(combined.includes('auth'));
            assert.ok(combined.includes('login'));
            assert.ok(combined.includes('custom'));
            assert.ok(combined.includes('keyword'));
        });

        test('should remove duplicates when combining', () => {
            const extracted = ['auth', 'login'];
            const userProvided = ['auth', 'custom'];
            
            const combined = combineKeywords(extracted, userProvided);
            
            const authCount = combined.filter(k => k === 'auth').length;
            assert.strictEqual(authCount, 1);
        });

        test('should handle empty user-provided keywords', () => {
            const extracted = ['auth', 'login'];
            
            const combined = combineKeywords(extracted, []);
            
            assert.ok(combined.includes('auth'));
            assert.ok(combined.includes('login'));
        });

        test('should handle undefined user-provided keywords', () => {
            const extracted = ['auth', 'login'];
            
            const combined = combineKeywords(extracted, undefined);
            
            assert.ok(combined.includes('auth'));
            assert.ok(combined.includes('login'));
        });

        test('should normalize user-provided keywords to lowercase', () => {
            const extracted = ['auth'];
            const userProvided = ['UPPER', 'Mixed'];
            
            const combined = combineKeywords(extracted, userProvided);
            
            assert.ok(combined.includes('upper'));
            assert.ok(combined.includes('mixed'));
            assert.ok(!combined.includes('UPPER'));
            assert.ok(!combined.includes('Mixed'));
        });

        test('should trim user-provided keywords', () => {
            const extracted = ['auth'];
            const userProvided = ['  spaced  ', 'normal'];
            
            const combined = combineKeywords(extracted, userProvided);
            
            assert.ok(combined.includes('spaced'));
            assert.ok(combined.includes('normal'));
        });

        test('should filter empty strings from user-provided', () => {
            const extracted = ['auth'];
            const userProvided = ['', '  ', 'valid'];
            
            const combined = combineKeywords(extracted, userProvided);
            
            assert.ok(combined.includes('valid'));
            assert.ok(!combined.includes(''));
        });
    });

    suite('calculateKeywordMatchScore', () => {
        test('should return 0 for empty text', () => {
            const result = calculateKeywordMatchScore('', ['auth']);
            
            assert.strictEqual(result.score, 0);
            assert.deepStrictEqual(result.matchedKeywords, []);
        });

        test('should return 0 for empty keywords', () => {
            const result = calculateKeywordMatchScore('some text', []);
            
            assert.strictEqual(result.score, 0);
            assert.deepStrictEqual(result.matchedKeywords, []);
        });

        test('should score text with matching keywords', () => {
            const result = calculateKeywordMatchScore(
                'This is an authentication module for login',
                ['authentication', 'login']
            );
            
            assert.ok(result.score > 0);
            assert.ok(result.matchedKeywords.includes('authentication'));
            assert.ok(result.matchedKeywords.includes('login'));
        });

        test('should return higher score for more matches', () => {
            const singleMatch = calculateKeywordMatchScore('auth', ['auth']);
            const multipleMatches = calculateKeywordMatchScore(
                'auth auth auth',
                ['auth']
            );
            
            assert.ok(multipleMatches.score >= singleMatch.score);
        });

        test('should be case insensitive', () => {
            const result = calculateKeywordMatchScore(
                'AUTHENTICATION Login',
                ['authentication', 'login']
            );
            
            assert.ok(result.score > 0);
            assert.ok(result.matchedKeywords.length > 0);
        });

        test('should cap score at 100', () => {
            const result = calculateKeywordMatchScore(
                'auth '.repeat(100),
                ['auth']
            );
            
            assert.ok(result.score <= 100);
        });

        test('should track matched keywords correctly', () => {
            const result = calculateKeywordMatchScore(
                'authentication module',
                ['authentication', 'login', 'module']
            );
            
            assert.ok(result.matchedKeywords.includes('authentication'));
            assert.ok(result.matchedKeywords.includes('module'));
            assert.ok(!result.matchedKeywords.includes('login'));
        });
    });

    suite('generateSearchPatterns', () => {
        test('should generate regex patterns for keywords', () => {
            const patterns = generateSearchPatterns(['auth', 'login']);
            
            assert.ok(patterns.length > 0);
            assert.ok(patterns.every(p => p instanceof RegExp));
        });

        test('should create case-insensitive patterns', () => {
            const patterns = generateSearchPatterns(['auth']);
            
            assert.ok(patterns.some(p => p.test('AUTH')));
            assert.ok(patterns.some(p => p.test('auth')));
            assert.ok(patterns.some(p => p.test('Auth')));
        });

        test('should escape special regex characters', () => {
            const patterns = generateSearchPatterns(['user.name', 'test[0]']);
            
            // Should not throw when used
            assert.ok(patterns.every(p => {
                try {
                    'test'.match(p);
                    return true;
                } catch {
                    return false;
                }
            }));
        });

        test('should match word boundaries', () => {
            const patterns = generateSearchPatterns(['auth']);
            
            // Should match 'auth' as a word
            assert.ok(patterns.some(p => p.test('auth module')));
            assert.ok(patterns.some(p => p.test('the auth system')));
        });

        test('should handle empty keywords array', () => {
            const patterns = generateSearchPatterns([]);
            
            assert.deepStrictEqual(patterns, []);
        });

        test('should create partial match patterns for longer keywords', () => {
            const patterns = generateSearchPatterns(['authentication']);
            
            // Should have multiple patterns (word boundary + partial)
            assert.ok(patterns.length >= 1);
        });
    });

    suite('Edge cases', () => {
        test('should handle very long single word', () => {
            const longWord = 'supercalifragilisticexpialidocious';
            const result = extractKeywords(longWord);
            
            assert.ok(result.keywords.includes(longWord));
        });

        test('should handle repeated patterns', () => {
            const result = extractKeywords('auth auth auth auth auth');
            
            const authCount = result.keywords.filter(k => k === 'auth').length;
            assert.strictEqual(authCount, 1);
        });

        test('should handle newlines and tabs', () => {
            const result = extractKeywords('first\nsecond\tthird');
            
            assert.ok(result.keywords.includes('first'));
            assert.ok(result.keywords.includes('second'));
            assert.ok(result.keywords.includes('third'));
        });

        test('should handle code snippets', () => {
            const result = extractKeywords('const user = getUser(); user.authenticate();');
            
            assert.ok(result.keywords.includes('user'));
            assert.ok(result.keywords.includes('authenticate'));
        });

        test('should handle URLs', () => {
            const result = extractKeywords('Check https://api.example.com/auth endpoint');
            
            assert.ok(result.keywords.includes('api'));
            assert.ok(result.keywords.includes('example'));
            assert.ok(result.keywords.includes('auth'));
            assert.ok(result.keywords.includes('endpoint'));
        });

        test('should handle JSON-like content', () => {
            const result = extractKeywords('{"user": "admin", "role": "superuser"}');
            
            assert.ok(result.keywords.includes('user'));
            assert.ok(result.keywords.includes('admin'));
            assert.ok(result.keywords.includes('role'));
            assert.ok(result.keywords.includes('superuser'));
        });

        test('should handle camelCase splitting', () => {
            const result = extractKeywords('getUserAuthentication');
            
            // Should split camelCase
            assert.ok(result.keywords.includes('user'));
            assert.ok(result.keywords.includes('authentication'));
        });
    });
});
