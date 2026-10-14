import type { GitCommit } from '@plusplusoneplusplus/coc-client';

/** SHA stays visible while the subject truncates in both Git and rail rows. */
export function CommitIdentity({ commit, unpushed = false }: {
    commit: Pick<GitCommit, 'shortHash' | 'subject'>;
    unpushed?: boolean;
}) {
    return <>
        <span className={`font-mono text-[11px] flex-shrink-0 ${unpushed ? 'text-[#f57c00] dark:text-[#ffb74d]' : 'text-[#0078d4] dark:text-[#3794ff]'}`} data-testid={`commit-hash-${commit.shortHash}`}>{commit.shortHash}</span>
        <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#ccc] truncate min-w-0 flex-1 leading-snug">
            {commit.subject}
        </span>
    </>;
}
