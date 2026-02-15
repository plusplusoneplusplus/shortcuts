/**
 * Content loading: showHome, loadModule, renderModulePage,
 * toggleSourceFiles, loadSpecialPage, loadTopicArticle, regenerateModule.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { moduleGraph, currentModuleId, setCurrentModuleId, markdownCache, escapeHtml } from './core';
import { setActive, showWikiContent } from './sidebar';

const config = (window as any).__WIKI_CONFIG__ as WikiConfig;

export function showHome(skipHistory?: boolean): void {
    setCurrentModuleId(null);
    setActive('__home');
    showWikiContent();
    const tocNav = document.getElementById('toc-nav');
    if (tocNav) tocNav.innerHTML = '';
    if (!skipHistory) {
        history.pushState({ type: 'home' }, '', location.pathname);
    }
    if (config.enableAI) {
        (window as any).updateAskSubject(moduleGraph.project.name);
    }

    const stats = {
        modules: moduleGraph.modules.length,
        categories: (moduleGraph.categories || []).length,
        language: moduleGraph.project.language,
        buildSystem: moduleGraph.project.buildSystem,
    };

    let html = '<div class="home-view">' +
        '<h1>' + escapeHtml(moduleGraph.project.name) + '</h1>' +
        '<p style="font-size: 15px; color: var(--content-muted); margin-bottom: 24px;">' +
        escapeHtml(moduleGraph.project.description) + '</p>' +
        '<div class="project-stats">' +
        '<div class="stat-card"><h3>Modules</h3><div class="value">' + stats.modules + '</div></div>' +
        '<div class="stat-card"><h3>Categories</h3><div class="value">' + stats.categories + '</div></div>' +
        '<div class="stat-card"><h3>Language</h3><div class="value small">' + escapeHtml(stats.language) + '</div></div>' +
        '<div class="stat-card"><h3>Build System</h3><div class="value small">' + escapeHtml(stats.buildSystem) + '</div></div>' +
        '</div>';

    const hasDomains = moduleGraph.domains && moduleGraph.domains.length > 0;
    if (hasDomains) {
        moduleGraph.domains.forEach(function (domain: any) {
            const domainModules = moduleGraph.modules.filter(function (mod: any) {
                if (mod.domain === area.id) return true;
                return area.modules && area.modules.indexOf(mod.id) !== -1;
            });
            if (domainModules.length === 0) return;

            html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">' + escapeHtml(area.name) + '</h3>';
            if (area.description) {
                html += '<p style="color: var(--content-muted); margin-bottom: 12px; font-size: 14px;">' +
                    escapeHtml(area.description) + '</p>';
            }
            html += '<div class="module-grid">';
            domainModules.forEach(function (mod: any) {
                html += '<div class="module-card" onclick="loadModule(\'' +
                    mod.id.replace(/'/g, "\\'") + '\')">' +
                    '<h4>' + escapeHtml(mod.name) +
                    ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                    mod.complexity + '</span></h4>' +
                    '<p>' + escapeHtml(mod.purpose) + '</p></div>';
            });
            html += '</div>';
        });

        const assignedIds = new Set<string>();
        moduleGraph.domains.forEach(function (domain: any) {
            moduleGraph.modules.forEach(function (mod: any) {
                if (mod.domain === area.id || (area.modules && area.modules.indexOf(mod.id) !== -1)) {
                    assignedIds.add(mod.id);
                }
            });
        });
        const unassigned = moduleGraph.modules.filter(function (mod: any) { return !assignedIds.has(mod.id); });
        if (unassigned.length > 0) {
            html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Other</h3><div class="module-grid">';
            unassigned.forEach(function (mod: any) {
                html += '<div class="module-card" onclick="loadModule(\'' +
                    mod.id.replace(/'/g, "\\'") + '\')">' +
                    '<h4>' + escapeHtml(mod.name) +
                    ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                    mod.complexity + '</span></h4>' +
                    '<p>' + escapeHtml(mod.purpose) + '</p></div>';
            });
            html += '</div>';
        }
    } else {
        html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">All Modules</h3><div class="module-grid">';
        moduleGraph.modules.forEach(function (mod: any) {
            html += '<div class="module-card" onclick="loadModule(\'' +
                mod.id.replace(/'/g, "\\'") + '\')">' +
                '<h4>' + escapeHtml(mod.name) +
                ' <span class="complexity-badge complexity-' + mod.complexity + '">' +
                mod.complexity + '</span></h4>' +
                '<p>' + escapeHtml(mod.purpose) + '</p></div>';
        });
        html += '</div>';
    }

    html += '</div>';

    const contentEl = document.getElementById('content');
    if (contentEl) contentEl.innerHTML = html;
    const contentScroll = document.getElementById('content-scroll');
    if (contentScroll) contentScroll.scrollTop = 0;
}

export async function loadModule(moduleId: string, skipHistory?: boolean): Promise<void> {
    const mod = moduleGraph.modules.find(function (m: any) { return m.id === moduleId; });
    if (!mod) return;

    setCurrentModuleId(moduleId);
    setActive(moduleId);
    showWikiContent();
    if (!skipHistory) {
        history.pushState({ type: 'module', id: moduleId }, '', location.pathname + '#module-' + encodeURIComponent(moduleId));
    }
    if (config.enableAI) {
        (window as any).updateAskSubject(mod.name);
    }

    if (markdownCache[moduleId]) {
        renderModulePage(mod, markdownCache[moduleId]);
        const contentScroll = document.getElementById('content-scroll');
        if (contentScroll) contentScroll.scrollTop = 0;
        return;
    }

    const contentEl = document.getElementById('content');
    if (contentEl) contentEl.innerHTML = '<div class="loading">Loading module...</div>';
    try {
        const res = await fetch('/api/modules/' + encodeURIComponent(moduleId));
        if (!res.ok) throw new Error('Failed to load module');
        const data = await res.json();
        if (data.markdown) {
            markdownCache[moduleId] = data.markdown;
            renderModulePage(mod, data.markdown);
        } else {
            if (contentEl) {
                contentEl.innerHTML =
                    '<div class="markdown-body"><h2>' + escapeHtml(mod.name) + '</h2>' +
                    '<p>' + escapeHtml(mod.purpose) + '</p></div>';
            }
        }
    } catch (err: any) {
        if (contentEl) {
            contentEl.innerHTML =
                '<p style="color: red;">Error loading module: ' + err.message + '</p>';
        }
    }
    const contentScroll = document.getElementById('content-scroll');
    if (contentScroll) contentScroll.scrollTop = 0;
}

export function renderModulePage(mod: any, markdown: string): void {
    let html = '';

    // Regenerate button
    html += '<div class="module-page-header" style="overflow: hidden; margin-bottom: 8px;">' +
        '<button class="module-regen-btn" id="module-regen-btn" ' +
        'onclick="regenerateModule(\'' + mod.id.replace(/'/g, "\\'") + '\')" ' +
        'style="display: none;" title="Regenerate this module\u2019s article using the latest analysis">' +
        '&#x1F504; Regenerate</button></div>';

    // Source files section
    if (mod.keyFiles && mod.keyFiles.length > 0) {
        html += '<div class="source-files-section" id="source-files">' +
            '<button class="source-files-toggle" onclick="toggleSourceFiles()">' +
            '<span class="source-files-arrow">&#x25B6;</span> Relevant source files' +
            '</button>' +
            '<div class="source-files-list">';
        mod.keyFiles.forEach(function (f: string) {
            html += '<span class="source-pill"><span class="source-pill-icon">&#9671;</span> ' +
                escapeHtml(f) + '</span>';
        });
        html += '</div></div>';
    }

    // Markdown content
    html += '<div class="markdown-body" id="module-article-body">' + marked.parse(markdown) + '</div>';
    const contentEl = document.getElementById('content');
    if (contentEl) contentEl.innerHTML = html;

    // Post-processing
    (window as any).processMarkdownContent();
    (window as any).buildToc();
    if (config.enableAI) {
        (window as any).addDeepDiveButton(mod.id);
    }

    checkRegenAvailability();
}

let regenAvailable: boolean | null = null;

async function checkRegenAvailability(): Promise<void> {
    try {
        if (regenAvailable === null) {
            const res = await fetch('/api/admin/generate/status');
            const data = await res.json();
            regenAvailable = data.available || false;
        }
        const btn = document.getElementById('module-regen-btn');
        if (btn && regenAvailable) {
            btn.style.display = '';
        }
    } catch (_e) {
        // Silently fail
    }
}

export async function regenerateModule(moduleId: string): Promise<void> {
    const btn = document.getElementById('module-regen-btn') as HTMLButtonElement | null;
    if (!btn || btn.disabled) return;

    if (!confirm('Regenerate the article for this module?\nThis will replace the current article with a freshly generated one.')) return;

    btn.disabled = true;
    btn.innerHTML = '&#x23F3; Regenerating\u2026';
    btn.classList.add('regen-running');

    const articleBody = document.getElementById('module-article-body');
    if (articleBody) {
        articleBody.classList.add('regen-overlay');
        const overlayText = document.createElement('div');
        overlayText.className = 'regen-overlay-text';
        overlayText.textContent = 'Regenerating article\u2026';
        articleBody.appendChild(overlayText);
    }

    try {
        const response = await fetch('/api/admin/generate/module/' + encodeURIComponent(moduleId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force: false })
        });

        if (!response.ok && response.headers.get('content-type')?.indexOf('text/event-stream') === -1) {
            const errData = await response.json();
            throw new Error(errData.error || 'Generation failed (HTTP ' + response.status + ')');
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let success = false;

        while (true) {
            const result = await reader.read();
            if (result.done) break;

            buffer += decoder.decode(result.value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (let li = 0; li < lines.length; li++) {
                const line = lines[li];
                if (!line.startsWith('data: ')) continue;
                try {
                    const event = JSON.parse(line.substring(6));
                    if (event.type === 'done') {
                        success = event.success;
                    }
                    if (event.type === 'error') {
                        throw new Error(event.message || 'Generation error');
                    }
                } catch (parseErr: any) {
                    if (parseErr.message && parseErr.message !== 'Generation error') continue;
                    throw parseErr;
                }
            }
        }

        if (success) {
            btn.innerHTML = '&#x2705; Regenerated';
            btn.classList.remove('regen-running');
            btn.classList.add('regen-success');
            delete markdownCache[moduleId];
            setTimeout(function () {
                loadModule(moduleId, true);
            }, 800);
        } else {
            throw new Error('Generation completed without success');
        }
    } catch (err: any) {
        btn.innerHTML = '&#x1F504; Regenerate';
        btn.classList.remove('regen-running');
        btn.disabled = false;
        if (articleBody) {
            articleBody.classList.remove('regen-overlay');
            const ot = articleBody.querySelector('.regen-overlay-text');
            if (ot) ot.remove();
        }
        alert('Regeneration failed: ' + err.message);
    }
}

export function toggleSourceFiles(): void {
    const section = document.getElementById('source-files');
    if (section) section.classList.toggle('expanded');
}

export async function loadSpecialPage(key: string, title: string, skipHistory?: boolean): Promise<void> {
    setCurrentModuleId(null);
    setActive(key);
    showWikiContent();
    if (!skipHistory) {
        history.pushState({ type: 'special', key: key, title: title }, '', location.pathname + '#' + encodeURIComponent(key));
    }

    const cacheKey = '__page_' + key;
    if (markdownCache[cacheKey]) {
        (window as any).renderMarkdownContent(markdownCache[cacheKey]);
        (window as any).buildToc();
        const contentScroll = document.getElementById('content-scroll');
        if (contentScroll) contentScroll.scrollTop = 0;
        return;
    }

    const contentEl = document.getElementById('content');
    if (contentEl) contentEl.innerHTML = '<div class="loading">Loading page...</div>';
    try {
        const res = await fetch('/api/pages/' + encodeURIComponent(key));
        if (!res.ok) throw new Error('Page not found');
        const data = await res.json();
        markdownCache[cacheKey] = data.markdown;
        (window as any).renderMarkdownContent(data.markdown);
        (window as any).buildToc();
    } catch (_err) {
        if (contentEl) contentEl.innerHTML = '<p>Content not available.</p>';
    }
    const contentScroll = document.getElementById('content-scroll');
    if (contentScroll) contentScroll.scrollTop = 0;
}

export async function loadTopicArticle(topicId: string, slug: string, skipHistory?: boolean): Promise<void> {
    setCurrentModuleId(null);
    const navId = 'topic:' + topicId + ':' + slug;
    setActive(navId);
    showWikiContent();
    if (!skipHistory) {
        history.pushState({ type: 'topic', topicId: topicId, slug: slug }, '', location.pathname + '#topic-' + encodeURIComponent(topicId) + '-' + encodeURIComponent(slug));
    }
    if (config.enableAI) {
        (window as any).updateAskSubject(topicId + '/' + slug);
    }

    const cacheKey = '__topic_' + topicId + '_' + slug;
    if (markdownCache[cacheKey]) {
        (window as any).renderMarkdownContent(markdownCache[cacheKey]);
        (window as any).buildToc();
        const contentScroll = document.getElementById('content-scroll');
        if (contentScroll) contentScroll.scrollTop = 0;
        return;
    }

    const contentEl = document.getElementById('content');
    if (contentEl) contentEl.innerHTML = '<div class="loading">Loading topic article...</div>';
    try {
        const res = await fetch('/api/topics/' + encodeURIComponent(topicId) + '/' + encodeURIComponent(slug));
        if (!res.ok) throw new Error('Topic article not found');
        const data = await res.json();
        markdownCache[cacheKey] = data.content;
        (window as any).renderMarkdownContent(data.content);
        (window as any).buildToc();
    } catch (err: any) {
        if (contentEl) {
            contentEl.innerHTML =
                '<p style="color: red;">Error loading topic article: ' + err.message + '</p>';
        }
    }
    const contentScroll = document.getElementById('content-scroll');
    if (contentScroll) contentScroll.scrollTop = 0;
}
