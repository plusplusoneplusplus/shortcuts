import { useEffect, useRef, useState } from 'react';
import type { SkillFileResponse } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { getSkillFileEntries, SkillVersionBadge } from '../../shared/SkillMetadata';
import { AgentSkillsIcons as I } from './agent-skills-icons';
import type { Skill } from './skills-ui-model';

export interface SkillFilePreviewProps {
    workspaceId: string;
    skill: Skill;
    detail: Skill | null;
    detailLoading: boolean;
    detailError: string | null;
    isOpen: boolean;
    sourceLabel: string;
    loadFile: (skillName: string, relativePath: string) => Promise<SkillFileResponse>;
}

export function SkillFilePreview({
    workspaceId,
    skill,
    detail,
    detailLoading,
    detailError,
    isOpen,
    sourceLabel,
    loadFile,
}: SkillFilePreviewProps) {
    const effectiveDetail = detail?.name === skill.name ? detail : skill;
    const fileEntries = getSkillFileEntries(effectiveDetail);
    const triggers = effectiveDetail.variables ?? [];
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [fileContent, setFileContent] = useState<string | null>(null);
    const [fileLoading, setFileLoading] = useState(false);
    const [fileError, setFileError] = useState<string | null>(null);
    const requestGeneration = useRef(0);

    useEffect(() => {
        requestGeneration.current += 1;
        setSelectedFile(null);
        setFileContent(null);
        setFileLoading(false);
        setFileError(null);
        return () => {
            requestGeneration.current += 1;
        };
    }, [isOpen, skill.name, workspaceId]);

    const closeFile = () => {
        requestGeneration.current += 1;
        setSelectedFile(null);
        setFileContent(null);
        setFileLoading(false);
        setFileError(null);
    };

    const selectFile = async (relativePath: string) => {
        if (selectedFile === relativePath) {
            closeFile();
            return;
        }
        const generation = ++requestGeneration.current;
        setSelectedFile(relativePath);
        setFileContent(null);
        setFileError(null);
        setFileLoading(true);
        try {
            const response = await loadFile(skill.name, relativePath);
            if (generation !== requestGeneration.current) {return;}
            setFileContent(response.content);
        } catch (error) {
            if (generation !== requestGeneration.current) {return;}
            setFileError(getSpaCocClientErrorMessage(error, 'Failed to read file'));
        } finally {
            if (generation === requestGeneration.current) {setFileLoading(false);}
        }
    };

    if (!isOpen) {return null;}

    return (
        <div className="ask-skill-detail" data-testid="skill-detail-panel">
            <div>
                <h5>Description</h5>
                <p>{detailLoading ? 'Loading…' : (effectiveDetail.description ?? 'No description.')}</p>
                {detailError && (
                    <p style={{ color: 'var(--ask-danger)' }} data-testid="skill-detail-error">{detailError}</p>
                )}

                <h5>Triggers</h5>
                <div className="ask-triggers">
                    {triggers.length > 0 ? triggers.map(trigger => (
                        <span key={trigger} className="ask-trigger-pill">/{trigger}</span>
                    )) : (
                        <span style={{ color: 'var(--ask-text-3)', fontSize: 12 }}>None declared</span>
                    )}
                </div>

                {effectiveDetail.output && effectiveDetail.output.length > 0 && (
                    <>
                        <h5>Output</h5>
                        <div className="ask-triggers">
                            {effectiveDetail.output.map(output => (
                                <span key={output} className="ask-trigger-pill">{output}</span>
                            ))}
                        </div>
                    </>
                )}

                {selectedFile ? (
                    <>
                        <div className="ask-file-viewer-header">
                            <h5>{selectedFile}</h5>
                            <button type="button" className="ask-btn ask-sm ask-ghost" onClick={closeFile} data-testid="skill-file-close">
                                Back to SKILL.md
                            </button>
                        </div>
                        {fileLoading ? (
                            <pre className="ask-codeblock">Loading…</pre>
                        ) : fileError ? (
                            <pre className="ask-codeblock" style={{ color: 'var(--ask-danger)' }} data-testid="skill-file-error">{fileError}</pre>
                        ) : (
                            <pre className="ask-codeblock" data-testid="skill-file-content">{fileContent}</pre>
                        )}
                    </>
                ) : effectiveDetail.promptBody ? (
                    <>
                        <h5>Skill body — SKILL.md (preview)</h5>
                        <pre className="ask-codeblock">{effectiveDetail.promptBody}</pre>
                    </>
                ) : null}
            </div>

            <aside className="ask-aside">
                <h5>Metadata</h5>
                <div className="ask-row">
                    <span className="ask-k">Source</span>
                    <span className="ask-v">{sourceLabel}</span>
                </div>
                {effectiveDetail.version && (
                    <div className="ask-row">
                        <span className="ask-k">Version</span>
                        <SkillVersionBadge version={effectiveDetail.version} className="ask-v" testId="skill-detail-version" />
                    </div>
                )}
                {fileEntries.length > 0 && (
                    <div className="ask-row">
                        <span className="ask-k">Files</span>
                        <span className="ask-v">{fileEntries.length}</span>
                    </div>
                )}
                {effectiveDetail.relativePath && (
                    <div className="ask-row">
                        <span className="ask-k">Path</span>
                        <span className="ask-v">{effectiveDetail.relativePath}</span>
                    </div>
                )}

                {fileEntries.length > 0 && (
                    <>
                        <h5 style={{ marginTop: 18 }}>Files</h5>
                        <div className="ask-file-list">
                            {fileEntries.map(entry => (
                                <button
                                    key={entry.relativePath}
                                    type="button"
                                    className={`ask-file-row ${selectedFile === entry.relativePath ? 'is-active' : ''}`}
                                    onClick={() => void selectFile(entry.relativePath)}
                                    title={`View ${entry.relativePath}`}
                                    data-testid={`skill-file-row-${entry.relativePath}`}
                                >
                                    <I.file className="ask-icon ask-ico" />
                                    <span>{entry.name}</span>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </aside>
        </div>
    );
}
