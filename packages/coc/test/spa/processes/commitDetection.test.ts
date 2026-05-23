import { describe, it, expect } from 'vitest';
import { detectCommitsInToolGroup, type DetectedCommit } from '../../../src/server/spa/client/react/features/chat/conversation/commitDetection';

function makeShellCall(id: string, command: string, result: string, status = 'completed') {
    return { id, toolName: 'powershell', args: { command }, result, status };
}

describe('detectCommitsInToolGroup', () => {
    describe('standard git commit output', () => {
        it('detects a simple commit', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "Fix bug"', [
                    '[main a1b2c3d] Fix bug',
                    ' 3 files changed, 42 insertions(+), 17 deletions(-)',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0]).toEqual<DetectedCommit>({
                shortHash: 'a1b2c3d',
                subject: 'Fix bug',
                branch: 'main',
                filesChanged: 3,
                insertions: 42,
                deletions: 17,
                toolCallId: 't1',
                isFixup: false,
            });
        });

        it('detects a root commit', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "Initial commit"', [
                    '[main (root-commit) abc1234] Initial commit',
                    ' 1 file changed, 10 insertions(+)',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].shortHash).toBe('abc1234');
            expect(commits[0].subject).toBe('Initial commit');
            expect(commits[0].branch).toBe('main');
            expect(commits[0].filesChanged).toBe(1);
            expect(commits[0].insertions).toBe(10);
            expect(commits[0].deletions).toBeUndefined();
        });

        it('detects commit with only deletions in diffstat', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "Remove dead code"', [
                    '[main f1e2d3c] Remove dead code',
                    ' 2 files changed, 5 deletions(-)',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].filesChanged).toBe(2);
            expect(commits[0].insertions).toBeUndefined();
            expect(commits[0].deletions).toBe(5);
        });

        it('detects commit without diffstat', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "Empty commit" --allow-empty', [
                    '[main 1234abc] Empty commit',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].shortHash).toBe('1234abc');
            expect(commits[0].filesChanged).toBeUndefined();
            expect(commits[0].insertions).toBeUndefined();
            expect(commits[0].deletions).toBeUndefined();
        });

        it('detects commit on feature branch', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "Add feature"', [
                    '[feature/cool-stuff abcdef1] Add feature',
                    ' 1 file changed, 5 insertions(+), 2 deletions(-)',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].branch).toBe('feature/cool-stuff');
        });
    });

    describe('multiple commits in one group', () => {
        it('detects commits from separate tool calls', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "First"', '[main abc1111] First\n 1 file changed, 1 insertion(+)'),
                makeShellCall('t2', 'git commit -m "Second"', '[main abc2222] Second\n 2 files changed, 3 insertions(+)'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(2);
            expect(commits[0].shortHash).toBe('abc1111');
            expect(commits[0].toolCallId).toBe('t1');
            expect(commits[1].shortHash).toBe('abc2222');
            expect(commits[1].toolCallId).toBe('t2');
        });

        it('deduplicates by short hash', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "First"', '[main abc1111] First'),
                makeShellCall('t2', 'git commit -m "Retry"', '[main abc1111] First'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
        });
    });

    describe('false positive prevention', () => {
        it('ignores git log output', () => {
            const toolCalls = [
                makeShellCall('t1', 'git log --oneline', [
                    'abc1234 Fix bug',
                    'def5678 Add feature',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });

        it('ignores git show output', () => {
            const toolCalls = [
                makeShellCall('t1', 'git show abc1234', [
                    'commit abc1234567890',
                    '[main abc1234] Some message',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });

        it('ignores git diff output', () => {
            const toolCalls = [
                makeShellCall('t1', 'git diff HEAD~1', 'diff --git a/file.txt b/file.txt'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });

        it('ignores non-shell tool calls', () => {
            const toolCalls = [
                { id: 't1', toolName: 'view', args: { path: '/file.txt' }, result: '[main abc1234] Fake commit' },
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });

        it('ignores non-git shell commands', () => {
            const toolCalls = [
                makeShellCall('t1', 'npm run build', 'Build succeeded\n[main abc1234] looks like a commit'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });

        it('ignores git blame output', () => {
            const toolCalls = [
                makeShellCall('t1', 'git blame file.txt', 'abc1234 (Author 2024-01-01) line content'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });
    });

    describe('merge and cherry-pick commits', () => {
        it('detects git merge commits', () => {
            const toolCalls = [
                makeShellCall('t1', 'git merge feature', [
                    'Merge made by the recursive strategy.',
                    '[main 1a2b3c4] Merge branch \'feature\'',
                    ' 5 files changed, 100 insertions(+), 20 deletions(-)',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].shortHash).toBe('1a2b3c4');
            expect(commits[0].subject).toBe("Merge branch 'feature'");
        });

        it('detects git cherry-pick commits', () => {
            const toolCalls = [
                makeShellCall('t1', 'git cherry-pick abc1234', [
                    '[main def5678] Cherry-picked commit',
                    ' 1 file changed, 2 insertions(+)',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].shortHash).toBe('def5678');
        });

        it('detects git revert commits', () => {
            const toolCalls = [
                makeShellCall('t1', 'git revert abc1234', [
                    '[main aaa1111] Revert "Some change"',
                    ' 1 file changed, 3 deletions(-)',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].shortHash).toBe('aaa1111');
        });
    });

    describe('edge cases', () => {
        it('returns empty array for empty input', () => {
            expect(detectCommitsInToolGroup([])).toEqual([]);
        });

        it('returns empty array when no results', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "test"', ''),
            ];

            expect(detectCommitsInToolGroup(toolCalls)).toEqual([]);
        });

        it('handles tool calls with no result', () => {
            const toolCalls = [
                { id: 't1', toolName: 'powershell', args: { command: 'git commit -m "test"' }, result: undefined },
            ];

            expect(detectCommitsInToolGroup(toolCalls as any)).toEqual([]);
        });

        it('handles Windows-style line endings', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "Fix"', '[main abc1234] Fix\r\n 1 file changed, 1 insertion(+)\r\n'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].shortHash).toBe('abc1234');
            expect(commits[0].filesChanged).toBe(1);
        });

        it('handles commit output with extra noise before/after', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "Fix"', [
                    'warning: LF will be replaced by CRLF',
                    '[main abc1234] Fix',
                    ' 1 file changed, 1 insertion(+)',
                    '',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
        });

        it('accepts shell as tool name', () => {
            const toolCalls = [
                { id: 't1', toolName: 'shell', args: { command: 'git commit -m "Fix"' }, result: '[main abc1234] Fix', status: 'completed' },
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
        });

        it('accepts bash as tool name (Linux/macOS regression)', () => {
            // On Linux/macOS the Copilot agent uses the "bash" tool name, not "shell" or "powershell".
            // Regression: bash tool calls were previously excluded from commit detection.
            const toolCalls = [
                {
                    id: 't1',
                    toolName: 'bash',
                    args: { command: 'git add -A && git commit -m "feat: add thing"', description: 'Commit changes' },
                    result: '[main 2fe0d631] feat: add thing\n 7 files changed, 153 insertions(+), 4 deletions(-)',
                    status: 'completed',
                },
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].shortHash).toBe('2fe0d631');
            expect(commits[0].subject).toBe('feat: add thing');
            expect(commits[0].branch).toBe('main');
            expect(commits[0].filesChanged).toBe(7);
            expect(commits[0].insertions).toBe(153);
            expect(commits[0].deletions).toBe(4);
            expect(commits[0].toolCallId).toBe('t1');
            expect(commits[0].isFixup).toBe(false);
        });

        it('bash tool: ignores read-only git commands', () => {
            const toolCalls = [
                { id: 't1', toolName: 'bash', args: { command: 'git log --oneline' }, result: '[main abc1234] Some old commit', status: 'completed' },
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });

        it('handles unknown command but matching git commit output', () => {
            // When args are missing, we should still try to detect
            const toolCalls = [
                { id: 't1', toolName: 'powershell', args: undefined, result: '[main abc1234] Fix', status: 'completed' },
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
        });

        it('handles args as a plain string', () => {
            const toolCalls = [
                { id: 't1', toolName: 'powershell', args: 'git commit -m "Fix"', result: '[main abc1234] Fix', status: 'completed' },
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
        });
    });

    describe('agent tool (task / general-purpose) results', () => {
        function makeAgentCall(id: string, toolName: string, result: string) {
            return { id, toolName, args: { prompt: 'do some work' }, result, status: 'completed' };
        }

        it('detects commit from task tool result with raw git output', () => {
            const toolCalls = [
                makeAgentCall('a1', 'task', [
                    'I committed the changes:',
                    '[main abc1234] feat: implement auth module',
                    ' 3 files changed, 42 insertions(+), 5 deletions(-)',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0]).toEqual<DetectedCommit>({
                shortHash: 'abc1234',
                subject: 'feat: implement auth module',
                branch: 'main',
                filesChanged: 3,
                insertions: 42,
                deletions: 5,
                toolCallId: 'a1',
                isFixup: false,
            });
        });

        it('detects commit from general-purpose tool result', () => {
            const toolCalls = [
                makeAgentCall('a1', 'general-purpose', [
                    'Done. Created a commit:',
                    '[feature/x def5678] fix: resolve null pointer',
                    ' 1 file changed, 2 insertions(+), 1 deletion(-)',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].shortHash).toBe('def5678');
            expect(commits[0].branch).toBe('feature/x');
        });

        it('returns 0 commits for prose-only agent result (documented limitation)', () => {
            const toolCalls = [
                makeAgentCall('a1', 'task', 'I committed the fix as `[CWS] abc1234`. All tests pass.'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });

        it('does not false-positive on git-log-looking lines in agent result', () => {
            const toolCalls = [
                makeAgentCall('a1', 'task', [
                    'Here are the recent commits:',
                    'abc1234 Fix bug',
                    'def5678 Add feature',
                    'The codebase looks good.',
                ].join('\n')),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });

        it('detects commits from task and shell in same group', () => {
            const toolCalls = [
                makeAgentCall('a1', 'task', '[main aaa1111] feat: from agent\n 1 file changed, 1 insertion(+)'),
                makeShellCall('s1', 'git commit -m "from shell"', '[main bbb2222] from shell\n 1 file changed, 1 insertion(+)'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(2);
            expect(commits[0].shortHash).toBe('aaa1111');
            expect(commits[0].toolCallId).toBe('a1');
            expect(commits[1].shortHash).toBe('bbb2222');
            expect(commits[1].toolCallId).toBe('s1');
        });

        it('deduplicates hash already seen from a shell call', () => {
            const toolCalls = [
                makeShellCall('s1', 'git commit -m "Fix"', '[main abc1234] Fix\n 1 file changed, 1 insertion(+)'),
                makeAgentCall('a1', 'task', 'Committed:\n[main abc1234] Fix\n 1 file changed, 1 insertion(+)'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].toolCallId).toBe('s1');
        });

        it('ignores agent results with no commit-like output', () => {
            const toolCalls = [
                makeAgentCall('a1', 'task', 'All tests pass. No changes needed.'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(0);
        });
    });

    describe('fixup / squash / amend commit detection', () => {
        it('marks fixup! commits with isFixup = true', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit --fixup abc1234', '[main aaa1111] fixup! Add user authentication\n 1 file changed, 1 insertion(+)'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].isFixup).toBe(true);
            expect(commits[0].subject).toBe('fixup! Add user authentication');
        });

        it('marks squash! commits with isFixup = true', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit --squash abc1234', '[main bbb2222] squash! Refactor parser\n 2 files changed, 5 insertions(+)'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].isFixup).toBe(true);
        });

        it('marks amend! commits with isFixup = true', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit --fixup=amend:abc1234', '[main ccc3333] amend! Improve error handling'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].isFixup).toBe(true);
        });

        it('regular commits have isFixup = false', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "Normal commit"', '[main ddd4444] Normal commit'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].isFixup).toBe(false);
        });

        it('mixed regular and fixup commits are correctly distinguished', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "feat: add auth"', '[main abc1111] feat: add auth\n 5 files changed, 42 insertions(+)'),
                makeShellCall('t2', 'git commit --fixup abc1111', '[main abc2222] fixup! feat: add auth\n 1 file changed, 1 insertion(+)'),
                makeShellCall('t3', 'git commit -m "docs: readme"', '[main abc3333] docs: readme\n 1 file changed, 3 insertions(+)'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(3);
            expect(commits[0].isFixup).toBe(false);
            expect(commits[1].isFixup).toBe(true);
            expect(commits[2].isFixup).toBe(false);
        });

        it('subject starting with "fixup" but not "fixup! " is not treated as fixup', () => {
            const toolCalls = [
                makeShellCall('t1', 'git commit -m "fixup the broken test"', '[main eee5555] fixup the broken test'),
            ];

            const commits = detectCommitsInToolGroup(toolCalls);
            expect(commits).toHaveLength(1);
            expect(commits[0].isFixup).toBe(false);
        });
    });
});
