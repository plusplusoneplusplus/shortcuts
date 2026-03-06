/**
 * Breadcrumbs — clickable path breadcrumb bar for spatial orientation in the explorer.
 * Styling matches AddRepoDialog / DAGBreadcrumb patterns.
 */

import { cn } from '../../shared/cn';

export interface BreadcrumbsProps {
    /** Path segments from repo root to current directory, e.g. ["src", "server", "spa"] */
    segments: string[];
    /** Called when user clicks a segment; index 0 = root */
    onNavigate: (segmentIndex: number) => void;
    repoName?: string;
    className?: string;
}

export function Breadcrumbs({ segments, onNavigate, repoName, className }: BreadcrumbsProps) {
    const rootLabel = repoName || 'root';

    return (
        <nav
            aria-label="Breadcrumb"
            className={cn('overflow-x-auto px-3 py-1', className)}
            data-testid="explorer-breadcrumbs"
        >
            <ol className="flex items-center gap-1 text-[10px] text-[#848484] truncate list-none m-0 p-0">
                {/* Root segment */}
                {segments.length === 0 ? (
                    <li>
                        <span className="text-[10px] text-[#848484]" data-testid="breadcrumb-segment-root">
                            📂 {rootLabel}
                        </span>
                    </li>
                ) : (
                    <li className="flex items-center gap-1">
                        <button
                            className="text-[10px] text-[#848484] hover:text-[#0078d4] dark:hover:text-[#3794ff] hover:underline cursor-pointer bg-transparent border-none p-0"
                            onClick={() => onNavigate(-1)}
                            data-testid="breadcrumb-segment-root"
                        >
                            📂 {rootLabel}
                        </button>
                    </li>
                )}

                {/* Path segments */}
                {segments.map((segment, index) => {
                    const isLast = index === segments.length - 1;
                    return (
                        <li key={index} className="flex items-center gap-1 min-w-0">
                            <span className="text-[#848484] flex-shrink-0">›</span>
                            {isLast ? (
                                <span
                                    className="text-[10px] text-[#1e1e1e] dark:text-[#cccccc] truncate"
                                    data-testid={`breadcrumb-segment-${index}`}
                                >
                                    {segment}
                                </span>
                            ) : (
                                <button
                                    className="text-[10px] text-[#848484] hover:text-[#0078d4] dark:hover:text-[#3794ff] hover:underline cursor-pointer bg-transparent border-none p-0 truncate"
                                    onClick={() => onNavigate(index)}
                                    data-testid={`breadcrumb-segment-${index}`}
                                >
                                    {segment}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
