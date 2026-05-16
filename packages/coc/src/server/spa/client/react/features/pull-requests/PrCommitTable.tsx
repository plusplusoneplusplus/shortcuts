import { formatTimestamp } from './pr-utils';

export interface PrCommitRow {
    sha: string;
    shortSha?: string;
    title: string;
    message?: string;
    author?: {
        displayName?: string;
        email?: string;
    };
    authoredAt?: string | Date;
    committedAt?: string | Date;
    url?: string;
}

interface PrCommitTableProps {
    rows: PrCommitRow[];
    loading?: boolean;
    error?: string | null;
}

export function PrCommitTable({ rows, loading = false, error = null }: PrCommitTableProps) {
    return (
        <div
            className="overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-commit-table"
        >
            <header className="flex min-h-[30px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                    Commits
                </h2>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    {loading ? 'Loading...' : `${rows.length} total`}
                </span>
            </header>
            {error && (
                <div
                    className="border-b border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200"
                    data-testid="pr-commits-error"
                >
                    Failed to load commits: {error}
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[12px]">
                    <thead>
                        <tr className="bg-gray-50 dark:bg-gray-800/60">
                            <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Commit
                            </th>
                            <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Author
                            </th>
                            <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Date
                            </th>
                            <th className="border-b border-gray-200 px-[7px] py-[5px] text-left text-[11px] font-semibold uppercase tracking-normal text-gray-500 dark:border-gray-700 dark:text-gray-400">
                                Hash
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && rows.length === 0 && (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="px-[7px] py-4 text-center text-[12px] text-gray-500 dark:text-gray-400"
                                    data-testid="pr-commits-empty"
                                >
                                    No commits found
                                </td>
                            </tr>
                        )}
                        {rows.map(row => (
                            <tr
                                key={row.sha}
                                className="border-b border-gray-100 last:border-0 dark:border-gray-800"
                                data-testid="pr-commit-row"
                            >
                                <td className="px-[7px] py-[5px] align-top text-[12px] text-gray-800 dark:text-gray-200">
                                    {row.url ? (
                                        <a
                                            href={row.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                                        >
                                            {row.title || row.sha}
                                        </a>
                                    ) : (
                                        <span className="font-medium">{row.title || row.sha}</span>
                                    )}
                                </td>
                                <td className="px-[7px] py-[5px] align-top text-[11px] text-gray-600 dark:text-gray-300">
                                    {row.author?.displayName || row.author?.email || 'Unknown'}
                                </td>
                                <td className="px-[7px] py-[5px] align-top text-[11px] text-gray-500 dark:text-gray-400">
                                    {formatCommitDate(row.committedAt ?? row.authoredAt)}
                                </td>
                                <td className="px-[7px] py-[5px] align-top font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                                    {row.shortSha || row.sha.slice(0, 7)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function formatCommitDate(value: string | Date | undefined): string {
    if (!value) return '';
    return formatTimestamp(value instanceof Date ? value.toISOString() : value);
}
