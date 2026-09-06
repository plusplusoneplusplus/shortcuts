/**
 * Unit coverage for the authored-commit → PR join (`matchAuthoredPrs`).
 *
 * A chat that made the commits but did not open the PR gets nothing from
 * `unionAssociations`: the PR's single `pull_request_chat_bindings` row belongs
 * to the chat that ran `submit-commits-as-pr`. The join below recovers the link
 * client-side from the commits the authoring chat detected in its own tool
 * output, so it must survive the cherry-pick that rewrites every SHA — and must
 * not cross-link two chats that happen to share a generic subject.
 */
import { describe, expect, it } from 'vitest';
import {
    authoredJoinKeys,
    matchAuthoredPrs,
    type AuthoredCommitLike,
    type PrCommitLike,
    type PrDetailLike,
} from '../../../src/server/spa/client/react/features/chat/conversation/prChatAssociation';

function commit(partial: Partial<AuthoredCommitLike> & { subject: string }): AuthoredCommitLike {
    return { shortHash: '3d32522', isFixup: false, isAmend: false, ...partial };
}

const commitsMap = (entries: Record<string, PrCommitLike[]>) => new Map(Object.entries(entries));
const detailsMap = (entries: Record<string, PrDetailLike>) => new Map(Object.entries(entries));

describe('authoredJoinKeys', () => {
    it('keeps plain commits and drops fixup / amend ones', () => {
        const { subjects, shortHashes } = authoredJoinKeys([
            commit({ shortHash: 'aaaaaaa', subject: 'feat(composer): pill styling' }),
            commit({ shortHash: 'bbbbbbb', subject: 'fixup! feat(composer): pill styling', isFixup: true }),
            commit({ shortHash: 'ccccccc', subject: 'feat(composer): pill styling v2', isAmend: true }),
        ]);
        expect([...subjects]).toEqual(['feat(composer): pill styling']);
        expect(shortHashes).toEqual(['aaaaaaa']);
    });

    it('collapses whitespace so formatting noise does not block a match', () => {
        const { subjects } = authoredJoinKeys([commit({ subject: '  fix:   escape\tcontrol bytes  ' })]);
        expect([...subjects]).toEqual(['fix: escape control bytes']);
    });

    it('ignores hashes shorter than git’s default width', () => {
        expect(authoredJoinKeys([commit({ shortHash: 'abc', subject: 'x' })]).shortHashes).toEqual([]);
    });
});

describe('matchAuthoredPrs', () => {
    const authored = [
        commit({ shortHash: '3d32522', subject: 'feat(composer): wire file-mention popup into both composers' }),
        commit({ shortHash: '7a31063', subject: 'test(composer): file-mention key precedence in NewChatArea' }),
    ];

    it('matches across a cherry-pick: different SHA, same subject', () => {
        // The submit script cherry-picks, so the PR carries brand-new SHAs.
        const prCommits = commitsMap({
            '721': [
                { subject: 'feat(composer): wire file-mention popup into both composers' },
                { subject: 'chore: bump lockfile' },
            ],
        });
        expect(matchAuthoredPrs(authored, prCommits, new Map())).toEqual(['721']);
    });

    it('matches on the first line when the provider returns the full message', () => {
        const prCommits = commitsMap({
            '721': [
                {
                    message:
                        'test(composer): file-mention key precedence in NewChatArea\n\nAdds a regression test.\n',
                },
            ],
        });
        expect(matchAuthoredPrs(authored, prCommits, new Map())).toEqual(['721']);
    });

    it('matches on the short hash embedded in the submit script’s branch name', () => {
        const details = detailsMap({ '721': { sourceBranch: 'pr/3d32522-wire-file-mention-popup' } });
        expect(matchAuthoredPrs(authored, new Map(), details)).toEqual(['721']);
    });

    it('does not match a branch that merely resembles a hash', () => {
        const details = detailsMap({ '721': { sourceBranch: 'feature/deadbee-something' } });
        expect(matchAuthoredPrs(authored, new Map(), details)).toEqual([]);
    });

    it('excludes fixup and amend commits from the join', () => {
        const fixups = [
            commit({ shortHash: 'bbbbbbb', subject: 'fixup! feat(composer): pill styling', isFixup: true }),
            commit({ shortHash: 'ccccccc', subject: 'amend! feat(composer): pill styling', isAmend: true }),
        ];
        const prCommits = commitsMap({
            '721': [{ subject: 'fixup! feat(composer): pill styling' }, { subject: 'amend! feat(composer): pill styling' }],
        });
        const details = detailsMap({ '721': { sourceBranch: 'pr/bbbbbbb-pill-styling' } });
        expect(matchAuthoredPrs(fixups, prCommits, details)).toEqual([]);
    });

    it('requires the whole subject, so a shared generic subject does not cross-link', () => {
        const generic = [commit({ shortHash: 'aaaaaaa', subject: 'fix tests' })];
        const prCommits = commitsMap({ '900': [{ subject: 'fix tests in the parser' }] });
        expect(matchAuthoredPrs(generic, prCommits, new Map())).toEqual([]);
    });

    it('returns nothing when the candidate has neither a detail nor a commit list', () => {
        expect(matchAuthoredPrs(authored, new Map(), detailsMap({ '721': {} }))).toEqual([]);
    });

    it('returns nothing when the chat authored no usable commits', () => {
        const prCommits = commitsMap({ '721': [{ subject: 'anything' }] });
        expect(matchAuthoredPrs([], prCommits, new Map())).toEqual([]);
    });

    it('returns every matching candidate, details first then commit-only ones', () => {
        const details = detailsMap({ '800': { sourceBranch: 'pr/3d32522-x' } });
        const prCommits = commitsMap({
            '721': [{ subject: 'test(composer): file-mention key precedence in NewChatArea' }],
        });
        expect(matchAuthoredPrs(authored, prCommits, details)).toEqual(['800', '721']);
    });
});
