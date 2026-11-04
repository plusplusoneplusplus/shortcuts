import type { ServerSelection } from './useServerSelection';

export function RepositoryServerField({ id, server, onChange, disabled }: {
    id: string;
    server: ServerSelection;
    onChange: (id: string) => void;
    disabled?: boolean;
}) {
    return (
        <>
            <label className="text-xs font-medium text-[#616161] dark:text-[#999]" htmlFor={id}>Server</label>
            <select
                id={id}
                data-testid={id}
                value={server.serverId}
                onChange={e => onChange(e.target.value)}
                disabled={disabled}
                className="px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] disabled:opacity-60"
            >
                {server.choices.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
        </>
    );
}
