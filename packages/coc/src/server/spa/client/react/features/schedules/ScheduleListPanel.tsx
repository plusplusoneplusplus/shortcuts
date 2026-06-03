import { useState, useCallback, useMemo } from 'react';
import { Button } from '../../ui';
import { formatRelativeTime } from '../../utils/format';
import { normalizePromptScheduleMode } from './scheduleTypes';
import type { Schedule } from './scheduleTypes';

interface NotesAutoCommitProps {
    available: boolean;
    enabled: boolean;
    enabling: boolean;
    onEnable: () => void;
}

interface ScheduleListPanelProps {
    schedules: Schedule[];
    selectedId: string | null;
    onSelect: (scheduleId: string) => void;
    onNew: () => void;
    loading: boolean;
    onMove?: (scheduleId: string, destination: 'user' | 'repo') => Promise<void>;
    onRefresh?: () => void;
    notesAutoCommit?: NotesAutoCommitProps;
}

const NOTES_AUTOCOMMIT_NAME = 'Notes Auto-Commit';

type DotColor = 'active' | 'paused' | 'failed' | 'running';

function dotClass(status: string, isRunning: boolean): DotColor {
    if (isRunning) return 'running';
    if (status === 'failed' || status === 'stopped') return 'failed';
    if (status === 'paused') return 'paused';
    return 'active';
}

const DOT_BG: Record<DotColor, string> = {
    active: 'bg-[#1a7f37] dark:bg-[#3fb950]',
    paused: 'bg-[#6e7781] dark:bg-[#8b949e]',
    failed: 'bg-[#cf222e] dark:bg-[#f85149]',
    running: 'bg-[#0969da] dark:bg-[#58a6ff] animate-pulse',
};

function StatusListDot({ status, isRunning }: { status: string; isRunning: boolean }) {
    const variant = dotClass(status, isRunning);
    return (
        <span
            className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${DOT_BG[variant]}`}
            aria-label={isRunning ? 'Running' : status}
            title={isRunning ? 'Running' : status}
        />
    );
}

function nextRunLabel(schedule: Schedule): string {
    if (schedule.isRunning) return '';
    if (schedule.status === 'paused') return 'paused';
    if (schedule.status === 'failed' || schedule.status === 'stopped') return 'failed';
    if (schedule.status === 'active' && schedule.nextRun) return formatRelativeTime(schedule.nextRun);
    return '';
}

function ScheduleItem({
    schedule,
    isActive,
    onSelect,
    onDragStart,
}: {
    schedule: Schedule;
    isActive: boolean;
    onSelect: (id: string) => void;
    onDragStart?: (e: React.DragEvent, schedule: Schedule) => void;
}) {
    const isNotesAutoCommit = schedule.name === NOTES_AUTOCOMMIT_NAME;
    const nextLabel = nextRunLabel(schedule);
    const promptMode = normalizePromptScheduleMode(schedule.mode, 'autopilot');
    return (
        <li
            className={
                'repo-schedule-item grid items-center cursor-pointer rounded-md mx-1 px-2 py-1.5 ' +
                'transition-colors hover:bg-[#f6f8fa] dark:hover:bg-[#2a2d2e] ' +
                (isActive
                    ? 'bg-[#ddf4ff] dark:bg-[#1a3a5c] shadow-[inset_0_0_0_1px_#b6e3ff] dark:shadow-[inset_0_0_0_1px_#316dca]'
                    : '')
            }
            style={{
                gridTemplateColumns: '10px minmax(0,1fr) auto',
                gridTemplateRows: 'auto auto',
                gridTemplateAreas: '"dot name time" "dot meta meta"',
                columnGap: '8px',
                rowGap: '1px',
            }}
            role="option"
            aria-selected={isActive}
            onClick={() => onSelect(schedule.id)}
            draggable={!!onDragStart}
            onDragStart={onDragStart ? (e) => onDragStart(e, schedule) : undefined}
        >
            <span className="mt-[2px]" style={{ gridArea: 'dot' }}>
                <StatusListDot status={schedule.status} isRunning={schedule.isRunning} />
            </span>
            <span
                className={
                    'flex items-center gap-1.5 min-w-0 text-xs text-[#1f2328] dark:text-[#cccccc] ' +
                    (isActive ? 'font-medium' : 'font-medium')
                }
                style={{ gridArea: 'name' }}
            >
                <span className="truncate">{schedule.name}</span>
                {isNotesAutoCommit ? (
                    <span
                        className="flex-shrink-0 inline-flex items-center px-[7px] py-px rounded-full text-[10px] font-medium leading-4 bg-[#ffeff7] dark:bg-pink-900/40 text-[#bf3989] dark:text-pink-300 border border-[#ffadda] dark:border-pink-700/60"
                        data-testid="notes-badge"
                        data-type-label="notes"
                    >
                        Notes
                    </span>
                ) : schedule.source === 'repo' ? (
                    <span
                        className="flex-shrink-0 inline-flex items-center px-[7px] py-px rounded-full text-[10px] font-medium leading-4 bg-[#ddf4ff] dark:bg-[#1a3a5c] text-[#0969da] dark:text-[#4fc3f7] border border-[#b6e3ff] dark:border-[#316dca]"
                        data-testid="type-label-repo"
                        data-type-label="repo"
                    >
                        Repo
                    </span>
                ) : schedule.targetType === 'script' ? (
                    <span
                        className="flex-shrink-0 inline-flex items-center px-[7px] py-px rounded-full text-[10px] font-medium leading-4 bg-[#fff8c5] dark:bg-amber-900/40 text-[#9a6700] dark:text-amber-300 border border-[#d4a72c] dark:border-amber-700/60"
                        data-testid="type-label-script"
                        data-type-label="script"
                    >
                        Script
                    </span>
                ) : (
                    <span
                        className="flex-shrink-0 inline-flex items-center px-[7px] py-px rounded-full text-[10px] font-medium leading-4 bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[#656d76] dark:text-[#848484] border border-[#d8dee4] dark:border-[#3c3c3c]"
                        data-testid="type-label-prompt"
                        data-type-label="prompt"
                    >
                        Prompt
                    </span>
                )}
                {!isNotesAutoCommit && schedule.source !== 'repo' && (!schedule.targetType || schedule.targetType === 'prompt') && schedule.mode && promptMode !== 'autopilot' && (
                    <span
                        className="flex-shrink-0 inline-flex items-center px-[7px] py-px rounded-full text-[10px] font-medium leading-4 bg-[#fbf0ff] dark:bg-purple-900/40 text-[#8250df] dark:text-purple-300 border border-[#e5cffd] dark:border-purple-700/60 capitalize"
                        data-testid="list-mode-badge"
                    >
                        {promptMode}
                    </span>
                )}
            </span>
            <span
                className="text-[10px] text-[#656d76] dark:text-[#848484] whitespace-nowrap flex-shrink-0 tabular-nums"
                style={{ gridArea: 'time' }}
            >
                {nextLabel}
            </span>
            <span
                className="text-[10px] text-[#656d76] dark:text-[#848484] truncate"
                style={{ gridArea: 'meta' }}
                title={schedule.cronDescription}
            >
                {schedule.cronDescription}
            </span>
        </li>
    );
}

export function ScheduleListPanel({
    schedules,
    selectedId,
    onSelect,
    onNew,
    loading: _loading,
    onMove,
    onRefresh,
    notesAutoCommit,
}: ScheduleListPanelProps) {
    const [userCollapsed, setUserCollapsed] = useState(false);
    const [repoCollapsed, setRepoCollapsed] = useState(false);
    const [dropTarget, setDropTarget] = useState<'user' | 'repo' | null>(null);
    const [filter, setFilter] = useState('');

    const filtered = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return schedules;
        return schedules.filter((s) => {
            const hay = `${s.name} ${s.target} ${s.cronDescription}`.toLowerCase();
            return hay.includes(q);
        });
    }, [schedules, filter]);

    const userSchedules = filtered.filter((s) => s.source !== 'repo');
    const repoSchedules = filtered.filter((s) => s.source === 'repo');

    const handleDragStart = useCallback((e: React.DragEvent, schedule: Schedule) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
            scheduleId: schedule.id,
            source: schedule.source ?? 'user',
        }));
        e.dataTransfer.effectAllowed = 'move';
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, section: 'user' | 'repo') => {
        e.preventDefault();
        setDropTarget(null);
        if (!onMove) return;
        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            const fromSource = data.source ?? 'user';
            if ((section === 'repo' && fromSource !== 'repo') || (section === 'user' && fromSource === 'repo')) {
                onMove(data.scheduleId, section);
            }
        } catch { /* ignore invalid drag data */ }
    }, [onMove]);

    const handleDragEnter = useCallback((e: React.DragEvent, section: 'user' | 'repo') => {
        e.preventDefault();
        setDropTarget(section);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        const relatedTarget = e.relatedTarget as Node | null;
        if (!e.currentTarget.contains(relatedTarget)) {
            setDropTarget(null);
        }
    }, []);

    return (
        <div className="flex flex-col h-full min-h-0 bg-white dark:bg-[#1e1e1e]">
            {/* ── Sidebar head ─────────────────────────────────────────── */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#eaeef2] dark:border-[#3c3c3c]">
                <h2 className="text-sm font-semibold text-[#1f2328] dark:text-[#cccccc]">Schedules</h2>
                <span className="flex-1" />
                {onRefresh && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onRefresh}
                        title="Refresh schedules"
                        data-testid="schedules-refresh-btn"
                    >
                        ↻
                    </Button>
                )}
                <Button variant="primary" size="sm" onClick={onNew} data-testid="new-schedule-btn">
                    + New
                </Button>
            </div>

            {/* ── Filter input ────────────────────────────────────────── */}
            <div className="px-3 py-2 border-b border-[#eaeef2] dark:border-[#3c3c3c]">
                <input
                    type="search"
                    placeholder="Filter schedules…"
                    autoComplete="off"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs rounded-md border border-[#d0d7de] dark:border-[#3c3c3c] bg-[#f6f8fa] dark:bg-[#252526] text-[#1f2328] dark:text-[#cccccc] placeholder:text-[#848484] focus:outline-none focus:border-[#0969da] focus:bg-white dark:focus:bg-[#1e1e1e] focus:ring-2 focus:ring-[#0969da]/30"
                    data-testid="schedules-filter-input"
                    aria-label="Filter schedules"
                />
            </div>

            {/* ── Scrollable list ──────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto pb-4 pt-1">
                {/* ── MY SCHEDULES section ─────────────────────────────── */}
                <div className="flex items-center px-3 pt-2 pb-1">
                    <button
                        className="flex-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-[#656d76] dark:text-[#848484] font-semibold hover:text-[#1f2328] dark:hover:text-[#cccccc]"
                        onClick={() => setUserCollapsed(v => !v)}
                        aria-expanded={!userCollapsed}
                        data-testid="my-schedules-header"
                    >
                        <span aria-hidden>{userCollapsed ? '▶' : '▼'}</span>
                        MY SCHEDULES
                    </button>
                    {userSchedules.length > 0 && (
                        <span
                            className="ml-2 inline-flex items-center justify-center min-w-[18px] px-1.5 py-0 text-[10px] font-medium leading-4 rounded-full text-[#656d76] dark:text-[#848484] bg-[#f6f8fa] dark:bg-[#2a2a2a] border border-transparent tabular-nums"
                            data-testid="my-schedules-count"
                        >
                            {userSchedules.length}
                        </span>
                    )}
                </div>

                {!userCollapsed && (
                    <>
                        {/* Quick Actions: show when notes git is available but auto-commit not enabled */}
                        {notesAutoCommit?.available && !notesAutoCommit.enabled && (
                            <div
                                className="mx-3 mb-2 rounded-md overflow-hidden border border-[#ffcb47] bg-gradient-to-b from-[#fffaeb] to-[#fff8c5] dark:from-amber-900/30 dark:to-amber-900/20 dark:border-amber-700/60"
                                data-testid="quick-actions-bar"
                            >
                                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[#9a6700] dark:text-amber-300 font-semibold border-b border-amber-300/30 flex items-center gap-1">
                                    <span aria-hidden>★</span> Quick Action
                                </div>
                                <div className="px-3 py-2 flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-xs text-[#1f2328] dark:text-[#cccccc] font-medium">
                                            Enable Notes Auto-Commit
                                        </div>
                                        <div className="text-[10px] text-[#656d76] dark:text-[#848484]">
                                            Auto-save your notes every 30 min
                                        </div>
                                    </div>
                                    <Button
                                        variant="primary"
                                        size="sm"
                                        onClick={notesAutoCommit.onEnable}
                                        disabled={notesAutoCommit.enabling}
                                        data-testid="enable-autocommit-btn"
                                    >
                                        {notesAutoCommit.enabling ? '⏳' : 'Enable'}
                                    </Button>
                                </div>
                            </div>
                        )}
                        {userSchedules.length === 0 ? (
                            <div
                                className={'mx-3 mb-2 px-3 py-3 text-center text-xs text-[#656d76] dark:text-[#848484] rounded-md transition-colors ' +
                                    (dropTarget === 'user' ? 'bg-[#ddf4ff] dark:bg-blue-900/20 ring-2 ring-[#0969da]/40' : '')}
                                onDragOver={handleDragOver}
                                onDragEnter={(e) => handleDragEnter(e, 'user')}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, 'user')}
                                data-testid="user-schedules-dropzone"
                            >
                                <div className="text-xl mb-1" aria-hidden>💬</div>
                                <div className="text-xs font-medium mb-0.5 text-[#1f2328] dark:text-[#cccccc]">
                                    {filter ? 'No schedules match.' : 'Create a recurring prompt'}
                                </div>
                                {!filter && (
                                    <div className="text-[10px] text-[#656d76] dark:text-[#848484]">
                                        Automate code reviews, summaries, health checks, and more.
                                    </div>
                                )}
                            </div>
                        ) : (
                            <ul
                                className={'repo-schedule-list flex flex-col gap-0.5 rounded transition-colors py-0.5 ' +
                                    (dropTarget === 'user' ? 'bg-[#ddf4ff]/60 dark:bg-blue-900/20 ring-2 ring-[#0969da]/40' : '')}
                                data-testid="user-schedules-list"
                                onDragOver={handleDragOver}
                                onDragEnter={(e) => handleDragEnter(e, 'user')}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, 'user')}
                            >
                                {userSchedules.map(schedule => (
                                    <ScheduleItem
                                        key={schedule.id}
                                        schedule={schedule}
                                        isActive={schedule.id === selectedId}
                                        onSelect={onSelect}
                                        onDragStart={onMove ? handleDragStart : undefined}
                                    />
                                ))}
                            </ul>
                        )}
                    </>
                )}

                {/* ── REPO SCHEDULES section ──────────────────────────────── */}
                <div className="flex items-center px-3 pt-3 pb-1 mt-1 border-t border-[#eaeef2] dark:border-[#3c3c3c]">
                    <button
                        className="flex-1 flex items-center gap-1 text-[11px] uppercase tracking-wider text-[#656d76] dark:text-[#848484] font-semibold hover:text-[#1f2328] dark:hover:text-[#cccccc]"
                        onClick={() => setRepoCollapsed(v => !v)}
                        aria-expanded={!repoCollapsed}
                        data-testid="repo-schedules-header"
                    >
                        <span aria-hidden>{repoCollapsed ? '▶' : '▼'}</span>
                        REPO SCHEDULES
                    </button>
                    {repoSchedules.length > 0 && (
                        <span
                            className="ml-2 inline-flex items-center justify-center min-w-[18px] px-1.5 py-0 text-[10px] font-medium leading-4 rounded-full text-[#656d76] dark:text-[#848484] bg-[#f6f8fa] dark:bg-[#2a2a2a] border border-transparent tabular-nums"
                            data-testid="repo-schedules-count"
                        >
                            {repoSchedules.length}
                        </span>
                    )}
                </div>

                {!repoCollapsed && (
                    <>
                        <div
                            className="px-3 pb-1.5 text-[10px] text-[#656d76] dark:text-[#848484] font-mono"
                            data-testid="repo-schedules-path"
                        >
                            .github/schedules/
                        </div>
                        {repoSchedules.length === 0 ? (
                            <div
                                className={'mx-3 mb-2 px-3 py-2.5 text-xs text-[#656d76] dark:text-[#848484] rounded-md transition-colors ' +
                                    (dropTarget === 'repo' ? 'bg-teal-50 dark:bg-teal-900/20 ring-2 ring-teal-400/50' : '')}
                                onDragOver={handleDragOver}
                                onDragEnter={(e) => handleDragEnter(e, 'repo')}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, 'repo')}
                                data-testid="repo-schedules-dropzone"
                            >
                                No repo schedules found.
                            </div>
                        ) : (
                            <ul
                                className={'repo-schedule-list flex flex-col gap-0.5 rounded transition-colors py-0.5 ' +
                                    (dropTarget === 'repo' ? 'bg-teal-50 dark:bg-teal-900/20 ring-2 ring-teal-400/50' : '')}
                                data-testid="repo-schedules-list"
                                onDragOver={handleDragOver}
                                onDragEnter={(e) => handleDragEnter(e, 'repo')}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, 'repo')}
                            >
                                {repoSchedules.map(schedule => (
                                    <ScheduleItem
                                        key={schedule.id}
                                        schedule={schedule}
                                        isActive={schedule.id === selectedId}
                                        onSelect={onSelect}
                                        onDragStart={onMove ? handleDragStart : undefined}
                                    />
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
