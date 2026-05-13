/**
 * ProcessSidebar — left sidebar showing the process list.
 *
 * Mirrors CoC's ProcessesSidebar layout:
 *   - Stats bar (running / queued / completed counts)
 *   - New chat input
 *   - Process list grouped by status
 */

import React, { useState, useMemo } from 'react';
import type { RemoteProcess } from '../types';

interface ProcessSidebarProps {
    processes: RemoteProcess[];
    loading: boolean;
    selectedProcessId: string | null;
    onSelect: (processId: string) => void;
    onNewChat: (message: string) => void;
}

export function ProcessSidebar({ processes, loading, selectedProcessId, onSelect, onNewChat }: ProcessSidebarProps) {
    const [chatInput, setChatInput] = useState('');
    const [filter, setFilter] = useState('');

    const grouped = useMemo(() => {
        const running: RemoteProcess[] = [];
        const queued: RemoteProcess[] = [];
        const completed: RemoteProcess[] = [];
        const failed: RemoteProcess[] = [];

        const lowerFilter = filter.toLowerCase();
        const filtered = filter
            ? processes.filter(p =>
                (p.title || p.prompt || p.id).toLowerCase().includes(lowerFilter))
            : processes;

        for (const p of filtered) {
            switch (p.status) {
                case 'running': running.push(p); break;
                case 'queued': queued.push(p); break;
                case 'failed':
                case 'cancelled': failed.push(p); break;
                default: completed.push(p);
            }
        }
        return { running, queued, completed, failed };
    }, [processes, filter]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const msg = chatInput.trim();
        if (!msg) return;
        onNewChat(msg);
        setChatInput('');
    };

    const total = processes.length;
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
                placeholder="Filter processes…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
            />

            {/* Process list */}
            <div className="process-list-scroll">
                {loading && <div className="sidebar-loading-text">Loading…</div>}

                {!loading && processes.length === 0 && (
                    <div className="sidebar-empty-text">No processes yet. Start a new chat above.</div>
                )}

                {renderGroup('Running', grouped.running, '⏳', selectedProcessId, onSelect)}
                {renderGroup('Queued', grouped.queued, '⏸', selectedProcessId, onSelect)}
                {renderGroup('Failed', grouped.failed, '✗', selectedProcessId, onSelect)}
                {renderGroup('Completed', grouped.completed, '✓', selectedProcessId, onSelect)}
            </div>
        </aside>
    );
}

function renderGroup(
    label: string,
    items: RemoteProcess[],
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
            {items.map(p => (
                <div
                    key={p.id}
                    className={`process-card ${selectedId === p.id ? 'selected' : ''}`}
                    onClick={() => onSelect(p.id)}
                >
                    <div className="process-card-title">
                        {p.title || p.prompt || p.id}
                    </div>
                    <div className="process-card-meta">
                        {p.updatedAt
                            ? timeAgo(p.updatedAt)
                            : p.createdAt ? timeAgo(p.createdAt) : ''}
                    </div>
                </div>
            ))}
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
