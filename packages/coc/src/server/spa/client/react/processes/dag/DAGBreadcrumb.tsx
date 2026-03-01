import type { DAGNodeData } from './types';
import { cn } from '../../shared/cn';

export interface DAGBreadcrumbProps {
    nodes: DAGNodeData[];
    isDark: boolean;
}

export function DAGBreadcrumb({ nodes, isDark }: DAGBreadcrumbProps): JSX.Element | null {
    if (nodes.length === 0) return null;

    return (
        <div data-testid="dag-breadcrumb" className="flex items-center justify-center gap-0 mb-2 text-xs">
            {nodes.map((node, i) => {
                const stepNum = i + 1;
                const isCompleted = node.state === 'completed';
                const isRunning = node.state === 'running';

                let badgeClass: string;
                if (isCompleted) {
                    badgeClass = isDark
                        ? 'bg-[#16825d]/20 text-[#89d185]'
                        : 'bg-[#e6f4ea] text-[#16825d]';
                } else if (isRunning) {
                    badgeClass = isDark
                        ? 'bg-[#0078d4]/20 text-[#3794ff]'
                        : 'bg-[#e8f3ff] text-[#0078d4]';
                } else {
                    badgeClass = isDark
                        ? 'bg-[#3c3c3c] text-[#848484]'
                        : 'bg-[#f3f3f3] text-[#848484]';
                }

                return (
                    <span key={node.phase} className="flex items-center">
                        <span
                            data-testid={`breadcrumb-step-${node.phase}`}
                            className={cn(
                                'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold',
                                badgeClass,
                                isRunning && 'animate-pulse',
                            )}
                        >
                            {isCompleted ? '✓' : stepNum}
                        </span>
                        <span className="text-[10px] text-[#848484] ml-0.5 mr-1">{node.label}</span>
                        {i < nodes.length - 1 && (
                            <span className="w-6 h-[1px] bg-[#848484]/40" />
                        )}
                    </span>
                );
            })}
        </div>
    );
}
