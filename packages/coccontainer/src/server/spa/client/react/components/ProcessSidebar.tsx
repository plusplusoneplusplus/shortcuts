/**
 * ProcessSidebar — left sidebar showing queue tasks.
 *
 * Mirrors CoC's ProcessesSidebar layout:
 *   - Stats bar (running / queued / completed counts)
 *   - New chat input
 *   - Task list grouped by status (Running → Queued → Recent)
 */

import React, { useState, useMemo } from 'react';
import type { QueueTask } from '../types';

interface ProcessSidebarProps {
    tasks: QueueTask[];
    loading: boolean;
    selectedProcessId: string | null;
    onSelect: (processId: string) => void;
    onNewChat: (message: string) => void;
}

export function ProcessSidebar({ tasks, loading, selectedProcessId, onSelect, onNewChat }: ProcessSidebarProps) {
    const [chatInput, setChatInput] = useState('');
    const [filter, setFilter] = useState('');

    const grouped = useMemo(() => {
        const running: QueueTask[] = [];
        const queued: QueueTask[] = [];
        const completed: QueueTask[] = [];
        const failed: QueueTask[] = [];

        const lowerFilter = filter.toLowerCase();
        const filtered = filter
            ? tasks.filter(t =>
                taskTitle(t).toLowerCase().includes(lowerFilter))
            : tasks;

        for (const t of filtered) {
            switch (t.status) {
                case 'running': running.push(t); break;
                case 'queued': queued.push(t); break;
                case 'failed':
                case 'cancelled': failed.push(t); break;
                default: completed.push(t);
            }
        }
        return { running, queued, completed, failed };
    }, [tasks, filter]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const msg = chatInput.trim();
        if (!msg) return;
        onNewChat(msg);
        setChatInput('');
    };

    const total = tasks.length;
    const runCount = grouped.running.length;
    const queueCount = grouped.queued.length;

    return (
        <aside className="process-sidebar">
            {/* Stats bar */}
            <div className="sidebar-stats">
                <span className="stat">
                    <span className="stat-value">{total}</span> total
                </span>
                {runCount > 0 && (
                    <span className="stat stat-running">
                        <span className="stat-value">{runCount}</span> running
                    </span>
                )}
                {queueCount > 0 && (
                    <span className="stat stat-queued">
                        <span className="stat-value">{queueCount}</span> queued
                    </span>
                )}
            </div>

            {/* New chat */}
            <form className="new-chat-form" onSubmit={handleSubmit}>
                <input
                    type="text"
                    className="new-chat-input"
                    placeholder="New chat…"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                />
                <button type="submit" className="new-chat-btn" disabled={!chatInput.trim()}>
                    ➤
                </button>
            </form>

            {/* Search filter */}
            <input
                type="text"
                className="sidebar-filter"
                placeholder="Filter tasks…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
            />

            {/* Task list */}
            <div className="process-list-scroll">
                {loading && <div className="sidebar-loading-text">Loading…</div>}

                {!loading && tasks.length === 0 && (
                    <div className="sidebar-empty-text">No tasks yet. Start a new chat above.</div>
                )}

                {renderGroup('Running', grouped.running, '⏳', selectedProcessId, onSelect)}
                {renderGroup('Queued', grouped.queued, '⏸', selectedProcessId, onSelect)}
                {renderGroup('Failed', grouped.failed, '✗', selectedProcessId, onSelect)}
                {renderGroup('Completed', grouped.completed, '✓', selectedProcessId, onSelect)}
            </div>
        </aside>
    );
}

function taskTitle(t: QueueTask): string {
    if (t.displayName) return t.displayName;
    if (t.payload?.prompt) {
        const prompt = t.payload.prompt;
        return prompt.length > 80 ? prompt.slice(0, 77) + '…' : prompt;
    }
    return t.processId || t.id;
}

function renderGroup(
    label: string,
    items: QueueTask[],
    icon: string,
    selectedId: string | null,
    onSelect: (id: string) => void,
) {
    if (items.length === 0) return null;
    return (
        <div className="process-group">
            <div className="process-group-header">
                {icon} {label} <span className="process-group-count">({items.length})</span>
            </div>
            {items.map(t => {
                const selectId = t.processId || t.id;
                return (
                    <div
                        key={t.id}
                        className={`process-card ${selectedId === selectId ? 'selected' : ''}`}
                        onClick={() => onSelect(selectId)}
                    >
                        <div className="process-card-title">
                            {taskTitle(t)}
                        </div>
                        <div className="process-card-meta">
                            <span className={`task-status-badge task-status-${t.status}`}>{t.status}</span>
                            {' '}
                            {t.completedAt
                                ? timeAgo(t.completedAt)
                                : t.startedAt
                                    ? timeAgo(t.startedAt)
                                    : t.createdAt ? timeAgo(t.createdAt) : ''}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
