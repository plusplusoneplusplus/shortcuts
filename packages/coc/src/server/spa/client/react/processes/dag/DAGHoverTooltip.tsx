import type { PipelinePhase, PipelineConfig, InputConfig, FilterConfig, MapConfig, ReduceConfig, JobConfig } from '@plusplusoneplusplus/pipeline-core';

export interface DAGHoverTooltipProps {
    phase: PipelinePhase;
    config: PipelineConfig;
    anchor: { x: number; y: number };
    onMouseEnter: () => void;
    onMouseLeave: () => void;
}

const labelClass = 'text-[10px] uppercase text-[#848484]';
const valueClass = 'text-[11px] text-[#1e1e1e] dark:text-[#cccccc]';
const gridClass = 'grid grid-cols-[80px_1fr] gap-x-2 gap-y-1 text-xs';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    if (value == null || value === '') return null;
    return (
        <>
            <span className={labelClass}>{label}</span>
            <span className={valueClass}>{value}</span>
        </>
    );
}

function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + '…';
}

function InputTooltip({ config }: { config: InputConfig }) {
    const sourceType = config.from
        ? (Array.isArray(config.from) ? 'list' : config.from.type ?? 'csv')
        : config.generate ? 'generate' : config.items ? 'inline' : undefined;

    const filePath = config.from && !Array.isArray(config.from)
        ? (config.from as { path?: string }).path
        : undefined;

    const itemCount = config.items?.length
        ?? (config.from && Array.isArray(config.from) ? config.from.length : undefined);

    // Mini data preview: first 3 rows from inline items
    const previewItems = config.items?.slice(0, 3);

    return (
        <div data-testid="hover-tooltip-input-content">
            <div className={gridClass}>
                <Row label="Source" value={sourceType} />
                {filePath && <Row label="File" value={filePath} />}
                {itemCount != null && <Row label="Items" value={String(itemCount)} />}
                {config.limit != null && <Row label="Limit" value={String(config.limit)} />}
            </div>
            {previewItems && previewItems.length > 0 && (
                <div className="mt-1.5 border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-1">
                    <div className={labelClass + ' mb-0.5'}>Preview</div>
                    <div className="text-[10px] text-[#1e1e1e] dark:text-[#cccccc] space-y-0.5" data-testid="hover-tooltip-input-preview">
                        {previewItems.map((item, i) => (
                            <div key={i} className="truncate">
                                {Object.entries(item).map(([k, v]) => `${k}: ${v}`).join(', ')}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function FilterTooltip({ config }: { config: FilterConfig }) {
    const ruleSummary = config.rule?.rules?.[0]
        ? `${config.rule.rules[0].field} ${config.rule.rules[0].operator} ${config.rule.rules[0].value ?? ''}`
        : undefined;

    const aiPrompt = config.ai?.prompt
        ? truncate(config.ai.prompt, 80)
        : undefined;

    return (
        <div className={gridClass} data-testid="hover-tooltip-filter-content">
            <Row label="Type" value={config.type} />
            {ruleSummary && <Row label="Rule" value={ruleSummary} />}
            {aiPrompt && <Row label="Prompt" value={aiPrompt} />}
        </div>
    );
}

function MapTooltip({ config }: { config: MapConfig }) {
    const promptSnippet = config.prompt
        ? truncate(config.prompt, 100)
        : config.promptFile ? `File: ${config.promptFile}` : undefined;

    return (
        <div className={gridClass} data-testid="hover-tooltip-map-content">
            {promptSnippet && <Row label="Prompt" value={promptSnippet} />}
            {config.model && <Row label="Model" value={config.model} />}
            {config.parallel != null && <Row label="Parallel" value={String(config.parallel)} />}
            {config.output && config.output.length > 0 && <Row label="Output" value={config.output.join(', ')} />}
            {config.batchSize != null && <Row label="Batch" value={String(config.batchSize)} />}
        </div>
    );
}

function ReduceTooltip({ config }: { config: ReduceConfig }) {
    const promptSnippet = config.prompt
        ? truncate(config.prompt, 100)
        : config.promptFile ? `File: ${config.promptFile}` : undefined;

    return (
        <div className={gridClass} data-testid="hover-tooltip-reduce-content">
            <Row label="Type" value={config.type} />
            {promptSnippet && <Row label="Prompt" value={promptSnippet} />}
            {config.model && <Row label="Model" value={config.model} />}
        </div>
    );
}

function JobTooltip({ config }: { config: JobConfig }) {
    const promptSnippet = config.prompt
        ? truncate(config.prompt, 100)
        : config.promptFile ? `File: ${config.promptFile}` : undefined;

    return (
        <div className={gridClass} data-testid="hover-tooltip-job-content">
            {promptSnippet && <Row label="Prompt" value={promptSnippet} />}
            {config.model && <Row label="Model" value={config.model} />}
            {config.output && config.output.length > 0 && <Row label="Output" value={config.output.join(', ')} />}
        </div>
    );
}

const phaseLabels: Record<string, string> = {
    input: 'Input',
    filter: 'Filter',
    map: 'Map',
    reduce: 'Reduce',
    job: 'Job',
};

function PhaseTooltipContent({ phase, config }: { phase: PipelinePhase; config: PipelineConfig }) {
    switch (phase) {
        case 'input':
            return config.input ? <InputTooltip config={config.input} /> : null;
        case 'filter':
            return config.filter ? <FilterTooltip config={config.filter} /> : null;
        case 'map':
            return config.map ? <MapTooltip config={config.map} /> : null;
        case 'reduce':
            return config.reduce ? <ReduceTooltip config={config.reduce} /> : null;
        case 'job':
            return config.job ? <JobTooltip config={config.job} /> : null;
        default:
            return null;
    }
}

export function DAGHoverTooltip({ phase, config, anchor, onMouseEnter, onMouseLeave }: DAGHoverTooltipProps) {
    const content = <PhaseTooltipContent phase={phase} config={config} />;

    return (
        <div
            data-testid="dag-hover-tooltip"
            className="absolute bg-[#f8f8f8] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-md p-2 shadow-lg text-[11px] max-w-[280px] pointer-events-auto z-10"
            style={{
                left: anchor.x,
                top: anchor.y,
                transform: 'translate(-50%, -100%)',
                marginTop: -8,
            }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div className="text-[10px] font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">
                {phaseLabels[phase] ?? phase} Phase
            </div>
            {content ?? <div className="text-[10px] text-[#848484]">{phaseLabels[phase] ?? phase}</div>}
        </div>
    );
}
