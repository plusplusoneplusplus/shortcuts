/**
 * TopBar — matches CoC's top bar layout.
 *
 * Layout:  [☰]  [CoCContainer]  [repo-tab] [repo-tab] ... [+▾]  [⚙]
 *
 * Repo tabs are colored circles + name, pulled from all registered agents.
 * The "+" dropdown offers: Add workspace folder, Add specific repository, Add agent.
 */

import React, { useState, useEffect, useRef } from 'react';
import type { TaggedWorkspace } from '../App';

interface TopBarProps {
    workspaces: TaggedWorkspace[];
    selectedWsId: string | null;
    onSelectWorkspace: (id: string) => void;
    onAddAgent: () => void;
    onAddRepo: () => void;
    onOpenSettings: () => void;
    selectedWs: TaggedWorkspace | null;
}

export function TopBar({
    workspaces,
    selectedWsId,
    onSelectWorkspace,
    onAddAgent,
    onAddRepo,
    onOpenSettings,
    selectedWs,
}: TopBarProps) {
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu on outside click
    useEffect(() => {
        if (!addMenuOpen) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setAddMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [addMenuOpen]);

    return (
        <header className="top-bar">
            {/* Brand */}
            <button className="top-bar-hamburger" onClick={onOpenSettings} title="Settings">☰</button>
            <span className="top-bar-brand">CoCContainer</span>

            {/* Repo tabs */}
            <div className="repo-tab-strip">
                {workspaces.map(ws => {
                    const isSelected = ws.id === selectedWsId;
                    const label = ws.name || lastSegment(ws.rootPath) || ws.id;
                    return (
                        <button
                            key={`${ws.agentId}-${ws.id}`}
                            className={`repo-tab ${isSelected ? 'selected' : ''}`}
                            onClick={() => onSelectWorkspace(ws.id)}
                            title={`${label} (${ws.agentName})`}
                        >
                            <span className="repo-tab-dot" style={{ background: ws.color || '#848484' }} />
                            <span className="repo-tab-name">{label}</span>
                            {/* Unseen badge placeholder */}
                        </button>
                    );
                })}

                {/* Add button with dropdown */}
                <div className="add-menu-wrapper" ref={menuRef}>
                    <button
                        className="add-btn"
                        onClick={() => setAddMenuOpen(!addMenuOpen)}
                        title="Add..."
                    >
                        + <span className="add-btn-arrow">▾</span>
                    </button>

                    {addMenuOpen && (
                        <div className="add-dropdown">
                            <button className="add-dropdown-item" onClick={() => { setAddMenuOpen(false); onAddRepo(); }}>
                                <span className="add-dropdown-icon">📁</span>
                                Add workspace folder
                            </button>
                            <button className="add-dropdown-item" onClick={() => { setAddMenuOpen(false); onAddRepo(); }}>
                                <span className="add-dropdown-icon">+</span>
                                Add specific repository
                            </button>
                            <div className="add-dropdown-divider" />
                            <button className="add-dropdown-item" onClick={() => { setAddMenuOpen(false); onAddAgent(); }}>
                                <span className="add-dropdown-icon">🔗</span>
                                Add agent
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Right actions */}
            <div className="top-bar-right">
                <button className="top-bar-action-btn" onClick={onOpenSettings}>⚙</button>
            </div>
        </header>
    );
}

function lastSegment(p?: string): string {
    if (!p) return '';
    const cleaned = p.replace(/[\\/]+$/, '');
    const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
    return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}
