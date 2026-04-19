import { useState, useCallback } from 'react';
import { Button } from '../shared';
import { formatRelativeTime } from '../utils/format';
import { StatusDot } from './ScheduleStatusBadge';
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

function ScheduleItem({ schedule, isActive, onSelect, onDragStart }: { schedule: Schedule; isActive: boolean; onSelect: (id: string) => void; onDragStart?: (e: React.DragEvent, schedule: Schedule) => void }) {
    const isNotesAutoCommit = schedule.name === NOTES_AUTOCOMMIT_NAME;
    return (
        <li
            className={
                'repo-schedule-item flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer ' +
                'hover:bg-[#e8e8e8] dark:hover:bg-[#333] ' +
                (isActive
                    ? 'bg-[#e8e8e8] dark:bg-[#2a2d2e] border-l-2 border-[#0078d4]'
                    : '')
            }
            role="option"
            aria-selected={isActive}
            onClick={() => onSelect(schedule.id)}
            draggable={!!onDragStart}
            onDragStart={onDragStart ? (e) => onDragStart(e, schedule) : undefined}
        >
            <span className="flex-shrink-0">
                <StatusDot status={schedule.status} isRunning={schedule.isRunning} />
            </span>
            <span className={
                'flex-1 text-xs text-[#1e1e1e] dark:text-[#cccccc] truncate' +
                (isActive ? ' font-medium' : '')
            }>
                {schedule.name}
                {isNotesAutoCommit ? (
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium align-middle" data-testid="notes-badge">
                        [Notes]
                    </span>
                ) : schedule.source === 'repo' ? (
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-medium align-middle">
                        [Repo]
                    </span>
                ) : schedule.targetType === 'script' ? (
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#e8f0fe] dark:bg-[#1a3a5c] text-[#0078d4] font-medium align-middle">
                        [Script]
                    </span>
                ) : (
                    <span className="ml-1.5 text-[9px] px-1 py-0.5 rounded bg-[#f3f3f3] dark:bg-[#2a2a2a] text-[#848484] font-medium align-middle">
                        [Prompt]
                    </span>
                )}
                {!isNotesAutoCommit && schedule.source !== 'repo' && (!schedule.targetType || schedule.targetType === 'prompt') && schedule.mode && schedule.mode !== 'autopilot' && (
                    <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium align-middle capitalize" data-testid="list-mode-badge">{schedule.mode}</span>
                )}
            </span>
            <span className="text-[10px] text-[#848484] font-mono flex-shrink-0 hidden xl:block">
                {schedule.cronDescription}
            </span>
            {schedule.nextRun && schedule.status === 'active' && (
                <span className="text-[10px] text-[#848484] flex-shrink-0">
                    {formatRelativeTime(schedule.nextRun)}
                </span>
            )}
        </li>
    );
}

export function ScheduleListPanel({ schedules, selectedId, onSelect, onNew, loading: _loading, onMove, onRefresh, notesAutoCommit }: ScheduleListPanelProps) {
    const [userCollapsed, setUserCollapsed] = useState(false);
    const [repoCollapsed, setRepoCollapsed] = useState(false);
    const [dropTarget, setDropTarget] = useState<'user' | 'repo' | null>(null);

    const userSchedules = schedules.filter(s => s.source !== 'repo');
    const repoSchedules = schedules.filter(s => s.source === 'repo');

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
            // Only allow drops from the opposite section
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
        // Only clear if leaving the drop zone (not entering a child)
        const relatedTarget = e.relatedTarget as Node | null;
        if (!e.currentTarget.contains(relatedTarget)) {
            setDropTarget(null);
        }
    }, []);

    return (
        <>
            {/* ── MY SCHEDULES section ─────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <button
                    className="flex items-center gap-1 text-[11px] uppercase text-[#848484] font-medium hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                    onClick={() => setUserCollapsed(v => !v)}
                    aria-expanded={!userCollapsed}
                    data-testid="my-schedules-header"
                >
                    <span>{userCollapsed ? '▶' : '▼'}</span>
                    MY SCHEDULES{userSchedules.length > 0 ? ` (${userSchedules.length})` : ''}
                </button>
                <div className="flex items-center gap-1">
                    {onRefresh && (
                        <Button variant="ghost" size="sm" onClick={onRefresh} title="Refresh Schedules" data-testid="schedules-refresh-btn">
                            ↻
                        </Button>
                    )}
                    <Button variant="primary" size="sm" onClick={onNew} data-testid="new-schedule-btn">
                        + New
                    </Button>
                </div>
            </div>

            {!userCollapsed && (
                <>
                    {/* Quick Actions: show when notes git is available but auto-commit not enabled */}
                    {notesAutoCommit?.available && !notesAutoCommit.enabled && (
                        <div className="mx-4 mb-2 px-3 py-2 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10" data-testid="quick-actions-bar">
                            <div className="text-[11px] uppercase text-[#848484] font-medium mb-1.5">💡 Quick Actions</div>
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc] font-medium">📝 Enable Notes Auto-Commit</div>
                                    <div className="text-[11px] text-[#848484]">Auto-save notes every 30 min</div>
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
                            className={'px-4 pb-2 text-center text-sm text-[#848484] rounded transition-colors ' +
                                (dropTarget === 'user' ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400/50' : '')}
                            onDragOver={handleDragOver}
                            onDragEnter={(e) => handleDragEnter(e, 'user')}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, 'user')}
                            data-testid="user-schedules-dropzone"
                        >
                            <div className="text-2xl mb-1">🕐</div>
                            <div className="text-xs">No schedules yet. Click &quot;+ New&quot; to create one.</div>
                        </div>
                    ) : (
                        <ul
                            className={'repo-schedule-list px-2 pb-1 flex flex-col gap-0.5 overflow-y-auto rounded transition-colors ' +
                                (dropTarget === 'user' ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400/50' : '')}
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
            <div className="flex items-center justify-between px-4 pt-2 pb-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                <button
                    className="flex items-center gap-1 text-[11px] uppercase text-[#848484] font-medium hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                    onClick={() => setRepoCollapsed(v => !v)}
                    aria-expanded={!repoCollapsed}
                    data-testid="repo-schedules-header"
                >
                    <span>{repoCollapsed ? '▶' : '▼'}</span>
                    REPO SCHEDULES{repoSchedules.length > 0 ? ` (${repoSchedules.length})` : ''}
                </button>
            </div>

            {!repoCollapsed && (
                <>
                    <div className="px-4 pb-1 text-[10px] text-[#848484] font-mono" data-testid="repo-schedules-path">
                        .github/schedules/
                    </div>
                    {repoSchedules.length === 0 ? (
                        <div
                            className={'px-4 pb-3 text-xs text-[#848484] rounded transition-colors ' +
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
                            className={'repo-schedule-list px-2 pb-4 flex flex-col gap-0.5 overflow-y-auto rounded transition-colors ' +
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
        </>
    );
}
