/** Expanded detail view used by the compact global skills list. */

import type { SkillInfo } from '@plusplusoneplusplus/coc-client';
import { SkillVersionBadge } from './SkillMetadata';

export type { SkillInfo } from '@plusplusoneplusplus/coc-client';

export interface SkillDetailPanelProps {
    detail: SkillInfo | null;
    loading: boolean;
}

export function SkillDetailPanel({ detail, loading }: SkillDetailPanelProps) {
    if (loading) {
        return (
            <div className="px-3 pb-3 text-xs text-[#848484]" data-testid="skill-detail-loading">Loading detail...</div>
        );
    }
    if (!detail) {return null;}

    return (
        <div className="px-3 pb-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-2 flex flex-col gap-2" data-testid="skill-detail-panel">
            <div className="flex flex-wrap gap-1.5">
                <SkillVersionBadge version={detail.version} testId="skill-detail-version" />
                {detail.variables && detail.variables.length > 0 && (
                    <span className="text-[10px] bg-[#fef3e0] dark:bg-[#3c2e00] text-[#e37400] dark:text-[#fdd663] px-1.5 py-0.5 rounded" data-testid="skill-detail-variables">
                        {detail.variables.length} variable{detail.variables.length !== 1 ? 's' : ''}: {detail.variables.join(', ')}
                    </span>
                )}
                {detail.output && detail.output.length > 0 && (
                    <span className="text-[10px] bg-[#e6f4ea] dark:bg-[#0d3f1f] text-[#137333] dark:text-[#81c995] px-1.5 py-0.5 rounded" data-testid="skill-detail-output">
                        output: {detail.output.join(', ')}
                    </span>
                )}
                {detail.relativePath && (
                    <span className="text-[10px] text-[#848484] font-mono" data-testid="skill-detail-path">
                        {detail.relativePath}
                    </span>
                )}
            </div>

            {detail.references && detail.references.length > 0 && (
                <div data-testid="skill-detail-references">
                    <div className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-0.5">📎 References</div>
                    <div className="flex flex-wrap gap-1">
                        {detail.references.map(ref => (
                            <span key={ref} className="text-[10px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#333] px-1.5 py-0.5 rounded font-mono">{ref}</span>
                        ))}
                    </div>
                </div>
            )}

            {detail.scripts && detail.scripts.length > 0 && (
                <div data-testid="skill-detail-scripts">
                    <div className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-0.5">⚙️ Scripts</div>
                    <div className="flex flex-wrap gap-1">
                        {detail.scripts.map(script => (
                            <span key={script} className="text-[10px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#333] px-1.5 py-0.5 rounded font-mono">{script}</span>
                        ))}
                    </div>
                </div>
            )}

            {detail.promptBody && (
                <div data-testid="skill-detail-prompt">
                    <div className="text-[10px] font-medium text-[#616161] dark:text-[#999] mb-0.5">📝 Prompt</div>
                    <pre className="text-[11px] text-[#1e1e1e] dark:text-[#cccccc] bg-[#f9f9f9] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap font-mono">
                        {detail.promptBody}
                    </pre>
                </div>
            )}
        </div>
    );
}
