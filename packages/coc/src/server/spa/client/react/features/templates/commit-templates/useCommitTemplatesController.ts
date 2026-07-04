/**
 * useCommitTemplatesController — owns commit-template list/detail loading, the
 * `templates-changed` WebSocket refresh, workspace-change reset, delete, and the
 * create/edit/replicate selection state shared by RepoTemplatesTab and TemplatesTab.
 *
 * Selection (`selectedName`, `showCreate`, `editingName`) is exposed via setters so the
 * combined TemplatesTab can coordinate it with its other selection domains through the
 * pure reduceTemplatesPanel reducer.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Template, TemplateDetail } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../../api/cocClient';

export interface CommitTemplatesController {
    templates: Template[];
    loading: boolean;
    selectedName: string | null;
    detail: TemplateDetail | null;
    detailLoading: boolean;
    showCreate: boolean;
    editingName: string | null;
    replicateTarget: Template | null;
    /** Template being edited, resolved from the current list, or undefined. */
    editingTemplate: Template | undefined;
    setSelectedName: (name: string | null) => void;
    setShowCreate: (v: boolean) => void;
    setEditingName: (name: string | null) => void;
    setReplicateTarget: (t: Template | null) => void;
    fetchTemplates: () => Promise<void>;
    handleDelete: (name: string) => Promise<void>;
    /** Select a template for detail view, closing any open form. */
    selectTemplate: (name: string) => void;
    /** Open a blank create form, clearing the current selection. */
    openCreate: () => void;
    /** Open the edit form for a template, keeping the current selection. */
    openEdit: (name: string) => void;
    /** Close the create/edit form. */
    closeForm: () => void;
}

export function useCommitTemplatesController(workspaceId: string): CommitTemplatesController {
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedName, setSelectedName] = useState<string | null>(null);
    const [detail, setDetail] = useState<TemplateDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [editingName, setEditingName] = useState<string | null>(null);
    const [replicateTarget, setReplicateTarget] = useState<Template | null>(null);

    const fetchTemplates = useCallback(async () => {
        try {
            const nextTemplates = await getSpaCocClient().templates.list(workspaceId);
            setTemplates(nextTemplates);
        } catch {
            setTemplates([]);
        } finally {
            setLoading(false);
        }
    }, [workspaceId]);

    // Fetch detail on selection.
    useEffect(() => {
        if (!selectedName) { setDetail(null); return; }
        let cancelled = false;
        setDetailLoading(true);
        getSpaCocClient().templates.detail(workspaceId, selectedName).then(data => {
            if (!cancelled) { setDetail(data); setDetailLoading(false); }
        }).catch(() => {
            if (!cancelled) { setDetail(null); setDetailLoading(false); }
        });
        return () => { cancelled = true; };
    }, [workspaceId, selectedName]);

    const handleDelete = useCallback(async (name: string) => {
        if (!confirm(`Delete template "${name}"?`)) return;
        await getSpaCocClient().templates.delete(workspaceId, name);
        setSelectedName(prev => (prev === name ? null : prev));
        fetchTemplates();
    }, [workspaceId, fetchTemplates]);

    // Refresh on `templates-changed` WebSocket events.
    useEffect(() => {
        const wsHandler = () => fetchTemplates();
        window.addEventListener('templates-changed', wsHandler);
        return () => window.removeEventListener('templates-changed', wsHandler);
    }, [workspaceId, fetchTemplates]);

    // Load on mount and whenever the workspace changes.
    useEffect(() => {
        setLoading(true);
        fetchTemplates();
    }, [workspaceId, fetchTemplates]);

    // Reset commit-template selection/forms when the workspace changes.
    useEffect(() => {
        setSelectedName(null);
        setShowCreate(false);
        setEditingName(null);
        setReplicateTarget(null);
    }, [workspaceId]);

    const selectTemplate = useCallback((name: string) => {
        setSelectedName(name);
        setShowCreate(false);
        setEditingName(null);
    }, []);

    const openCreate = useCallback(() => {
        setShowCreate(true);
        setEditingName(null);
        setSelectedName(null);
    }, []);

    const openEdit = useCallback((name: string) => {
        setEditingName(name);
        setShowCreate(false);
    }, []);

    const closeForm = useCallback(() => {
        setShowCreate(false);
        setEditingName(null);
    }, []);

    const editingTemplate = editingName ? templates.find(t => t.name === editingName) : undefined;

    return {
        templates,
        loading,
        selectedName,
        detail,
        detailLoading,
        showCreate,
        editingName,
        replicateTarget,
        editingTemplate,
        setSelectedName,
        setShowCreate,
        setEditingName,
        setReplicateTarget,
        fetchTemplates,
        handleDelete,
        selectTemplate,
        openCreate,
        openEdit,
        closeForm,
    };
}
