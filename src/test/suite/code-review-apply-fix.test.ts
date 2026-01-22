/**
 * Code Review Apply Fix Tests
 * 
 * Tests for the apply fix functionality that allows users to select
 * and apply code review findings to files.
 * 
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import * as path from 'path';
import {
    ApplyFixesResult,
    ApplyFixResult,
    FindingApplyState,
    FindingWithState,
    ReviewFinding,
    ReviewSeverity
} from '../../shortcuts/code-review/types';
import {
    isApplicableFinding,
    toFindingWithState,
    resolveFilePath
} from '../../shortcuts/code-review/fix-applier';

/**
 * Helper to create a test finding
 */
function createTestFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
    return {
        id: `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        severity: 'warning' as ReviewSeverity,
        rule: 'test-rule',
        description: 'Test finding description',
        ...overrides
    };
}

suite('Apply Fix Types', () => {
    test('FindingApplyState has all expected values', () => {
        const states: FindingApplyState[] = ['pending', 'selected', 'applied', 'failed'];
        assert.strictEqual(states.length, 4);
    });

    test('FindingWithState extends ReviewFinding with state fields', () => {
        const findingWithState: FindingWithState = {
            id: 'test-1',
            severity: 'error',
            rule: 'security',
            description: 'SQL injection vulnerability',
            file: 'src/auth.ts',
            line: 42,
            applyState: 'pending',
            isApplicable: true
        };

        assert.strictEqual(findingWithState.applyState, 'pending');
        assert.strictEqual(findingWithState.isApplicable, true);
        assert.strictEqual(findingWithState.applyError, undefined);
    });

    test('FindingWithState can have applyError when failed', () => {
        const findingWithState: FindingWithState = {
            id: 'test-1',
            severity: 'error',
            rule: 'security',
            description: 'Test issue',
            applyState: 'failed',
            applyError: 'Code changed since review'
        };

        assert.strictEqual(findingWithState.applyState, 'failed');
        assert.strictEqual(findingWithState.applyError, 'Code changed since review');
    });

    test('ApplyFixResult has all required fields', () => {
        const result: ApplyFixResult = {
            findingId: 'finding-1',
            success: true,
            file: 'src/test.ts'
        };

        assert.strictEqual(result.findingId, 'finding-1');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.file, 'src/test.ts');
        assert.strictEqual(result.error, undefined);
    });

    test('ApplyFixResult can have error when failed', () => {
        const result: ApplyFixResult = {
            findingId: 'finding-1',
            success: false,
            error: 'File not found',
            file: 'src/missing.ts'
        };

        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, 'File not found');
    });

    test('ApplyFixesResult tracks multiple results', () => {
        const result: ApplyFixesResult = {
            total: 5,
            successful: 3,
            failed: 2,
            results: [
                { findingId: 'f1', success: true, file: 'a.ts' },
                { findingId: 'f2', success: true, file: 'b.ts' },
                { findingId: 'f3', success: true, file: 'c.ts' },
                { findingId: 'f4', success: false, error: 'Code changed' },
                { findingId: 'f5', success: false, error: 'File not found' }
            ],
            modifiedFiles: ['a.ts', 'b.ts', 'c.ts']
        };

        assert.strictEqual(result.total, 5);
        assert.strictEqual(result.successful, 3);
        assert.strictEqual(result.failed, 2);
        assert.strictEqual(result.results.length, 5);
        assert.strictEqual(result.modifiedFiles.length, 3);
    });
});

suite('isApplicableFinding', () => {
    test('returns false for finding without file', () => {
        const finding = createTestFinding({
            line: 10,
            suggestion: 'Use const instead of let'
        });

        assert.strictEqual(isApplicableFinding(finding), false);
    });

    test('returns false for finding without line number', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            suggestion: 'Use const instead of let'
        });

        assert.strictEqual(isApplicableFinding(finding), false);
    });

    test('returns false for finding without suggestion or suggestedCode', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 10
        });

        assert.strictEqual(isApplicableFinding(finding), false);
    });

    test('returns true for finding with file, line, and suggestion', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: 'Use const instead of let'
        });

        assert.strictEqual(isApplicableFinding(finding), true);
    });

    test('returns true for finding with file, line, and suggestedCode', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestedCode: 'const x = 1;'
        });

        assert.strictEqual(isApplicableFinding(finding), true);
    });

    test('returns false for finding with empty suggestion', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: '   '
        });

        assert.strictEqual(isApplicableFinding(finding), false);
    });

    test('returns false for finding with empty suggestedCode', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestedCode: ''
        });

        assert.strictEqual(isApplicableFinding(finding), false);
    });

    test('prefers suggestedCode over suggestion for applicability', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestedCode: 'const x = 1;',
            suggestion: 'Use const'
        });

        assert.strictEqual(isApplicableFinding(finding), true);
    });
});

suite('toFindingWithState', () => {
    test('converts ReviewFinding to FindingWithState with pending state', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: 'Fix this'
        });

        const result = toFindingWithState(finding);

        assert.strictEqual(result.applyState, 'pending');
        assert.strictEqual(result.id, finding.id);
        assert.strictEqual(result.file, finding.file);
        assert.strictEqual(result.isApplicable, true);
    });

    test('sets isApplicable to false for non-applicable finding', () => {
        const finding = createTestFinding({
            // No file or line
        });

        const result = toFindingWithState(finding);

        assert.strictEqual(result.isApplicable, false);
        assert.strictEqual(result.applyState, 'pending');
    });

    test('preserves all original finding properties', () => {
        const finding = createTestFinding({
            id: 'custom-id',
            severity: 'error',
            rule: 'security-rule',
            ruleFile: 'security.md',
            file: 'src/auth.ts',
            line: 42,
            endLine: 45,
            description: 'Security vulnerability',
            codeSnippet: 'const pass = "secret"',
            suggestion: 'Use environment variables',
            suggestedCode: 'const pass = process.env.PASSWORD',
            explanation: 'Hardcoded secrets are bad'
        });

        const result = toFindingWithState(finding);

        assert.strictEqual(result.id, 'custom-id');
        assert.strictEqual(result.severity, 'error');
        assert.strictEqual(result.rule, 'security-rule');
        assert.strictEqual(result.ruleFile, 'security.md');
        assert.strictEqual(result.file, 'src/auth.ts');
        assert.strictEqual(result.line, 42);
        assert.strictEqual(result.endLine, 45);
        assert.strictEqual(result.description, 'Security vulnerability');
        assert.strictEqual(result.codeSnippet, 'const pass = "secret"');
        assert.strictEqual(result.suggestion, 'Use environment variables');
        assert.strictEqual(result.suggestedCode, 'const pass = process.env.PASSWORD');
        assert.strictEqual(result.explanation, 'Hardcoded secrets are bad');
    });
});

suite('resolveFilePath', () => {
    test('returns absolute path unchanged', () => {
        // Use platform-appropriate absolute path for testing
        const absolutePath = process.platform === 'win32' 
            ? 'C:\\Users\\user\\project\\src\\test.ts'
            : '/home/user/project/src/test.ts';
        const result = resolveFilePath(absolutePath);

        assert.strictEqual(result, absolutePath);
    });

    test('returns platform absolute path correctly', () => {
        // Test with the actual platform's path format
        const absolutePath = path.resolve('/home/user/project/src/test.ts');
        const result = resolveFilePath(absolutePath);

        // On this platform, an absolute path should be returned unchanged
        assert.strictEqual(result, absolutePath);
    });

    test('joins relative path with repository root', () => {
        const relativePath = 'src/test.ts';
        const repoRoot = process.platform === 'win32'
            ? 'C:\\Users\\user\\project'
            : '/home/user/project';
        const result = resolveFilePath(relativePath, repoRoot);

        assert.strictEqual(result, path.join(repoRoot, relativePath));
    });

    test('joins relative path with platform-specific repository root', () => {
        const relativePath = path.join('src', 'test.ts');
        const repoRoot = path.resolve('/tmp/test-project');
        const result = resolveFilePath(relativePath, repoRoot);

        assert.strictEqual(result, path.join(repoRoot, relativePath));
    });

    test('handles relative path without repository root', () => {
        const relativePath = 'src/test.ts';
        // Without repo root, it may use workspace folder or return the path as-is
        const result = resolveFilePath(relativePath);

        // The result should contain the relative path
        assert.ok(result.includes('src'));
        assert.ok(result.includes('test.ts'));
    });

    test('handles path with spaces', () => {
        const relativePath = 'src/my file.ts';
        const repoRoot = process.platform === 'win32'
            ? 'C:\\Users\\user\\my project'
            : '/home/user/my project';
        const result = resolveFilePath(relativePath, repoRoot);

        assert.strictEqual(result, path.join(repoRoot, relativePath));
    });
});

suite('ReviewFinding Extended Fields', () => {
    test('ReviewFinding supports endLine for multi-line fixes', () => {
        const finding: ReviewFinding = {
            id: 'test-1',
            severity: 'warning',
            rule: 'style',
            description: 'Multi-line issue',
            file: 'src/test.ts',
            line: 10,
            endLine: 15
        };

        assert.strictEqual(finding.line, 10);
        assert.strictEqual(finding.endLine, 15);
    });

    test('ReviewFinding supports suggestedCode for auto-apply', () => {
        const finding: ReviewFinding = {
            id: 'test-1',
            severity: 'warning',
            rule: 'style',
            description: 'Use const',
            file: 'src/test.ts',
            line: 10,
            codeSnippet: 'let x = 1;',
            suggestedCode: 'const x = 1;'
        };

        assert.strictEqual(finding.codeSnippet, 'let x = 1;');
        assert.strictEqual(finding.suggestedCode, 'const x = 1;');
    });

    test('ReviewFinding supports isApplicable flag', () => {
        const applicableFinding: ReviewFinding = {
            id: 'test-1',
            severity: 'error',
            rule: 'security',
            description: 'Fix this',
            file: 'src/test.ts',
            line: 10,
            suggestedCode: 'fixed code',
            isApplicable: true
        };

        const nonApplicableFinding: ReviewFinding = {
            id: 'test-2',
            severity: 'info',
            rule: 'architecture',
            description: 'Consider refactoring',
            isApplicable: false
        };

        assert.strictEqual(applicableFinding.isApplicable, true);
        assert.strictEqual(nonApplicableFinding.isApplicable, false);
    });
});

suite('State Transitions', () => {
    test('pending -> selected transition', () => {
        const finding = toFindingWithState(createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: 'Fix'
        }));

        assert.strictEqual(finding.applyState, 'pending');

        finding.applyState = 'selected';
        assert.strictEqual(finding.applyState, 'selected');
    });

    test('selected -> pending transition (deselect)', () => {
        const finding = toFindingWithState(createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: 'Fix'
        }));

        finding.applyState = 'selected';
        assert.strictEqual(finding.applyState, 'selected');

        finding.applyState = 'pending';
        assert.strictEqual(finding.applyState, 'pending');
    });

    test('selected -> applied transition', () => {
        const finding = toFindingWithState(createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: 'Fix'
        }));

        finding.applyState = 'selected';
        finding.applyState = 'applied';
        
        assert.strictEqual(finding.applyState, 'applied');
    });

    test('selected -> failed transition', () => {
        const finding = toFindingWithState(createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: 'Fix'
        }));

        finding.applyState = 'selected';
        finding.applyState = 'failed';
        finding.applyError = 'Code changed since review';
        
        assert.strictEqual(finding.applyState, 'failed');
        assert.strictEqual(finding.applyError, 'Code changed since review');
    });

    test('failed -> pending transition (retry)', () => {
        const finding = toFindingWithState(createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: 'Fix'
        }));

        finding.applyState = 'failed';
        finding.applyError = 'Some error';

        // Reset for retry
        finding.applyState = 'pending';
        finding.applyError = undefined;
        
        assert.strictEqual(finding.applyState, 'pending');
        assert.strictEqual(finding.applyError, undefined);
    });
});

suite('Filter and Selection Logic', () => {
    function createFindingsWithState(): FindingWithState[] {
        return [
            toFindingWithState(createTestFinding({
                id: 'f1',
                severity: 'error',
                file: 'src/a.ts',
                line: 10,
                suggestion: 'Fix error'
            })),
            toFindingWithState(createTestFinding({
                id: 'f2',
                severity: 'warning',
                file: 'src/b.ts',
                line: 20,
                suggestion: 'Fix warning'
            })),
            toFindingWithState(createTestFinding({
                id: 'f3',
                severity: 'suggestion',
                file: 'src/c.ts',
                line: 30,
                suggestion: 'Suggestion'
            })),
            toFindingWithState(createTestFinding({
                id: 'f4',
                severity: 'info',
                // No file/line - not applicable
            }))
        ];
    }

    test('filter by errors returns only error severity', () => {
        const findings = createFindingsWithState();
        const filtered = findings.filter(f => f.severity === 'error');

        assert.strictEqual(filtered.length, 1);
        assert.strictEqual(filtered[0].id, 'f1');
    });

    test('filter by warnings returns only warning severity', () => {
        const findings = createFindingsWithState();
        const filtered = findings.filter(f => f.severity === 'warning');

        assert.strictEqual(filtered.length, 1);
        assert.strictEqual(filtered[0].id, 'f2');
    });

    test('filter by suggestions returns suggestion and info severity', () => {
        const findings = createFindingsWithState();
        const filtered = findings.filter(f => f.severity === 'suggestion' || f.severity === 'info');

        assert.strictEqual(filtered.length, 2);
    });

    test('select all applicable findings', () => {
        const findings = createFindingsWithState();
        
        for (const finding of findings) {
            if (finding.isApplicable) {
                finding.applyState = 'selected';
            }
        }

        const selectedCount = findings.filter(f => f.applyState === 'selected').length;
        assert.strictEqual(selectedCount, 3); // f1, f2, f3 have file+line+suggestion
    });

    test('get selected count', () => {
        const findings = createFindingsWithState();
        findings[0].applyState = 'selected';
        findings[1].applyState = 'selected';

        const selectedCount = findings.filter(f => f.applyState === 'selected').length;
        assert.strictEqual(selectedCount, 2);
    });

    test('check if all applicable are selected', () => {
        const findings = createFindingsWithState();
        
        // Select all applicable
        for (const finding of findings) {
            if (finding.isApplicable) {
                finding.applyState = 'selected';
            }
        }

        const applicableFindings = findings.filter(f => f.isApplicable);
        const allSelected = applicableFindings.every(f => f.applyState === 'selected');

        assert.strictEqual(allSelected, true);
    });

    test('applied findings are not selectable', () => {
        const findings = createFindingsWithState();
        findings[0].applyState = 'applied';

        const selectableFindings = findings.filter(
            f => f.isApplicable && f.applyState !== 'applied' && f.applyState !== 'failed'
        );

        assert.strictEqual(selectableFindings.length, 2); // f2, f3
        assert.ok(!selectableFindings.some(f => f.id === 'f1'));
    });

    test('failed findings are not selectable', () => {
        const findings = createFindingsWithState();
        findings[0].applyState = 'failed';

        const selectableFindings = findings.filter(
            f => f.isApplicable && f.applyState !== 'applied' && f.applyState !== 'failed'
        );

        assert.strictEqual(selectableFindings.length, 2); // f2, f3
    });
});

suite('ApplyFixesResult Computation', () => {
    test('computes success rate correctly', () => {
        const result: ApplyFixesResult = {
            total: 10,
            successful: 7,
            failed: 3,
            results: [],
            modifiedFiles: []
        };

        const successRate = result.successful / result.total;
        assert.strictEqual(successRate, 0.7);
    });

    test('handles all successful', () => {
        const result: ApplyFixesResult = {
            total: 5,
            successful: 5,
            failed: 0,
            results: [],
            modifiedFiles: ['a.ts', 'b.ts']
        };

        assert.strictEqual(result.failed, 0);
        assert.strictEqual(result.successful, result.total);
    });

    test('handles all failed', () => {
        const result: ApplyFixesResult = {
            total: 5,
            successful: 0,
            failed: 5,
            results: [],
            modifiedFiles: []
        };

        assert.strictEqual(result.successful, 0);
        assert.strictEqual(result.modifiedFiles.length, 0);
    });

    test('tracks unique modified files', () => {
        const result: ApplyFixesResult = {
            total: 4,
            successful: 4,
            failed: 0,
            results: [
                { findingId: 'f1', success: true, file: 'src/a.ts' },
                { findingId: 'f2', success: true, file: 'src/a.ts' }, // Same file
                { findingId: 'f3', success: true, file: 'src/b.ts' },
                { findingId: 'f4', success: true, file: 'src/c.ts' }
            ],
            modifiedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'] // Unique files
        };

        assert.strictEqual(result.modifiedFiles.length, 3);
        assert.ok(result.modifiedFiles.includes('src/a.ts'));
        assert.ok(result.modifiedFiles.includes('src/b.ts'));
        assert.ok(result.modifiedFiles.includes('src/c.ts'));
    });
});

suite('Cross-Platform Path Handling', () => {
    test('handles platform absolute paths', () => {
        // Use platform-appropriate absolute path
        const absolutePath = process.platform === 'win32'
            ? 'C:\\Users\\user\\project\\src\\file.ts'
            : '/home/user/project/src/file.ts';
        assert.strictEqual(resolveFilePath(absolutePath), absolutePath);
    });

    test('handles resolved absolute paths', () => {
        // path.resolve always gives an absolute path for the current platform
        const absolutePath = path.resolve('/home/user/project/src/file.ts');
        assert.strictEqual(resolveFilePath(absolutePath), absolutePath);
    });

    test('relative paths are joined with repo root on any platform', () => {
        const relativePath = 'src/file.ts';
        const repoRoot = path.resolve('/tmp/test-repo');
        const result = resolveFilePath(relativePath, repoRoot);

        assert.strictEqual(result, path.join(repoRoot, relativePath));
    });

    test('normalizes mixed path separators when joining', () => {
        const relativePath = 'src/file.ts';
        const repoRoot = process.platform === 'win32'
            ? 'C:\\Users\\user\\project'
            : '/home/user/project';
        const result = resolveFilePath(relativePath, repoRoot);

        // Should use the platform's path separator
        assert.ok(result.includes('src'));
        assert.ok(result.includes('file.ts'));
    });

    test('handles relative paths with parent directory', () => {
        const relativePath = '../other/file.ts';
        const repoRoot = process.platform === 'win32'
            ? 'C:\\Users\\user\\project'
            : '/home/user/project';
        const result = resolveFilePath(relativePath, repoRoot);

        assert.strictEqual(result, path.join(repoRoot, relativePath));
    });

    test('Windows-style paths on Windows are absolute', function() {
        // This test only makes sense on Windows
        if (process.platform !== 'win32') {
            this.skip();
            return;
        }
        const windowsPath = 'C:\\Users\\user\\project\\src\\file.ts';
        assert.strictEqual(resolveFilePath(windowsPath), windowsPath);
    });

    test('UNC paths on Windows are absolute', function() {
        // This test only makes sense on Windows
        if (process.platform !== 'win32') {
            this.skip();
            return;
        }
        const uncPath = '\\\\server\\share\\project\\src\\file.ts';
        assert.strictEqual(resolveFilePath(uncPath), uncPath);
    });
});

suite('Edge Cases', () => {
    test('handles finding with zero as line number', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 0, // Edge case: line 0
            suggestion: 'Fix'
        });

        // Line 0 is falsy but should still be considered valid
        // However, in most editors, lines are 1-indexed
        assert.strictEqual(finding.line, 0);
        assert.strictEqual(isApplicableFinding(finding), false); // 0 is falsy
    });

    test('handles finding with line number 1', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 1,
            suggestion: 'Fix'
        });

        assert.strictEqual(isApplicableFinding(finding), true);
    });

    test('handles very long file paths', () => {
        const longPath = 'src/' + 'a/'.repeat(50) + 'file.ts';
        const finding = createTestFinding({
            file: longPath,
            line: 1,
            suggestion: 'Fix'
        });

        assert.strictEqual(isApplicableFinding(finding), true);
    });

    test('handles special characters in file path', () => {
        const finding = createTestFinding({
            file: 'src/[component]/file (1).ts',
            line: 10,
            suggestion: 'Fix'
        });

        assert.strictEqual(isApplicableFinding(finding), true);
    });

    test('handles unicode in suggestion', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: 'Use const instead of let // 使用常量'
        });

        assert.strictEqual(isApplicableFinding(finding), true);
    });

    test('handles multiline suggestion', () => {
        const finding = createTestFinding({
            file: 'src/test.ts',
            line: 10,
            suggestion: `if (condition) {
    doSomething();
}`
        });

        assert.strictEqual(isApplicableFinding(finding), true);
    });

    test('handles empty finding ID gracefully', () => {
        const finding = createTestFinding({
            id: '',
            file: 'src/test.ts',
            line: 10,
            suggestion: 'Fix'
        });

        const result = toFindingWithState(finding);
        assert.strictEqual(result.id, '');
    });
});
