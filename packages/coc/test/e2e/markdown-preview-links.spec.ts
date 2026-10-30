import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

let script: string;
let worker: string;
let css: string;
test.beforeAll(async () => {
    // The same source-bundle fixture pattern as panel-tab-reordering.spec.ts.
    // Nothing is written to the running server's dist directory.
    const utilityCss = (await postcss([tailwindcss({
        content: [
            './src/server/spa/client/react/features/repo-detail/explorer/PreviewPane.tsx',
            './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabStrip.tsx',
            './src/server/spa/client/react/shared/file-path/MarkdownFileLinkScope.tsx',
            './src/server/spa/client/react/shared/file-viewer/MonacoFileEditor.tsx',
            './src/server/spa/client/react/features/canvas/components/CanvasBodyRenderer.tsx',
        ],
        corePlugins: { preflight: true },
    })]).process('@tailwind base; @tailwind components; @tailwind utilities;', { from: undefined })).css;
    const bundle = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import './src/server/spa/client/react/features/repo-detail/explorer/monaco-setup';
            import './src/server/spa/client/react/shared/file-path/file-path-preview';
            import { CanvasBodyRenderer } from './src/server/spa/client/react/features/canvas/components/CanvasBodyRenderer';
            import { PreviewPane } from './src/server/spa/client/react/features/repo-detail/explorer/PreviewPane';
            import { ThemeProvider } from './src/server/spa/client/react/layout/ThemeProvider';
            import { UnifiedPanelHostProvider } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelHost';
            import { useUnifiedPanelTabs } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/useUnifiedPanelTabs';
            import { UnifiedPanelTabStrip } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabStrip';
            import { openUnifiedPanelTab } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
            const host = { workspaceId: 'ws', chatId: 'chat' };
            openUnifiedPanelTab('ws', { kind: 'file', ownerWorkspaceId: 'ws', ownerRoutingRef: null,
                chatId: 'chat', resourceId: 'docs/plan.md', label: 'plan.md' });
            window.fixture = { editors: {}, openCanvas: () => openUnifiedPanelTab('ws', {
                kind: 'canvas', ownerWorkspaceId: 'ws', ownerRoutingRef: null, chatId: 'chat', resourceId: 'canvas-plan', label: 'Canvas plan',
            }) };
            function Fixture() {
                const api = useUnifiedPanelTabs('ws', 'chat', true);
                window.fixture.tabs = api.tabs;
                window.fixture.activeId = api.activeId;
                return <UnifiedPanelHostProvider host={host}>
                    <input aria-label="Chat draft" defaultValue="keep this chat" />
                    <UnifiedPanelTabStrip tabs={api.tabs} activeId={api.activeId} onActivate={api.activate}
                        onClose={api.close} onCloseMany={() => {}} />
                    {api.tabs.map(tab => <div key={tab.id} style={{display: api.activeId === tab.id ? 'block' : 'none', height: 500}}>
                        {tab.kind === 'canvas' ? <CanvasBodyRenderer workspaceId="ws" routingRef={null} canvasId="canvas-plan"
                            canvas={{ id: 'canvas-plan', type: 'markdown', content: '[Canvas source](src/main.txt#L13-L16)' }}
                            kind={{ isCode: false, isSvg: false, isExtension: false, isExcalidraw: false, isKusto: false }}
                            loading={false} loadError={null} viewingVersion={null} viewingRevision={1}
                            displayedContent="[Canvas source](src/main.txt#L13-L16)" draft="" mode="preview"
                            onDraftChange={() => {}} onCanvasSaved={() => {}} onSelectionChange={() => {}}
                            onImageMenu={() => {}} notify={() => {}} /> :
                        <PreviewPane repoId={tab.ownerWorkspaceId} routingRef={tab.ownerRoutingRef}
                            filePath={tab.resourceId} fileName={tab.label} markdownPreview
                            revealLine={tab.line} endLine={tab.endLine} revealNonce={tab.revealNonce}
                            onModelShare={context => { if (context) window.fixture.editors[tab.resourceId] = context; }} />}
                    </div>)}
                </UnifiedPanelHostProvider>;
            }
            createRoot(document.getElementById('fixture')).render(<ThemeProvider><Fixture /></ThemeProvider>);
        ` },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        alias: { '@plusplusoneplusplus/forge/editor/rendering': path.resolve('../forge/src/editor/rendering/index.ts') },
        outfile: 'markdown-preview-fixture.js',
        loader: { '.css': 'css', '.ttf': 'dataurl', '.woff2': 'dataurl' },
        conditions: ['production'],
    });
    script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
    css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text + utilityCss;
    worker = (await build({ entryPoints: ['monaco-editor/esm/vs/editor/editor.worker.js'],
        bundle: true, write: false, format: 'iife', platform: 'browser',
    })).outputFiles[0].text;
});

test('Markdown file-tab clicks reveal exact ranges without navigation and retain dirty source and chat state', async ({ page }) => {
    const errors: string[] = [];
    const documents: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.isNavigationRequest()) documents.push(request.url()); });
    await page.route('http://markdown.test/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('editor.worker.js')) return route.fulfill({ contentType: 'text/javascript', body: worker });
        if (url.pathname === '/api/workspaces') return route.fulfill({ json: { workspaces: [{ id: 'ws', rootPath: '/repo' }] } });
        if (url.pathname.endsWith('/blob')) return route.fulfill({ json: {
            content: url.searchParams.get('path') === 'docs/plan.md'
                ? '[First](../src/main.txt:42-58)\n\n[Again](../src/main.txt#L7-L9)'
                : Array.from({ length: 120 }, (_, i) => 'source line ' + (i + 1)).join('\n'),
            encoding: 'utf-8', mimeType: 'text/plain',
        } });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
        return route.fulfill({ contentType: 'text/html', body: '<div id="fixture"></div>' });
    });
    await page.goto('http://markdown.test/');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await expect(page.getByTestId('preview-markdown')).toBeVisible();
    await page.getByTestId('preview-markdown').locator('.md-link').filter({ hasText: 'First' }).click();
    await expect(page.getByRole('tab', { name: /main.txt/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => {
        const context = (window as any).fixture.editors['src/main.txt'];
        return context?.model.getAllDecorations().filter((d: any) => d.options.isWholeLine)
            .map((d: any) => [d.range.startLineNumber, d.range.endLineNumber]);
    })).toContainEqual([42, 58]);
    await page.evaluate(() => {
        const { editor } = (window as any).fixture.editors['src/main.txt'];
        editor.executeEdits('test', [{ range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 }, text: 'dirty ' }]);
    });
    await page.getByRole('tab', { name: /plan.md/ }).click();
    await page.getByTestId('preview-markdown').locator('.md-link').filter({ hasText: 'Again' }).click();
    await expect.poll(() => page.evaluate(() => {
        const context = (window as any).fixture.editors['src/main.txt'];
        return context?.model.getAllDecorations().filter((d: any) => d.options.isWholeLine)
            .map((d: any) => [d.range.startLineNumber, d.range.endLineNumber]);
    })).toContainEqual([7, 9]);
    await expect.poll(() => page.evaluate(() => {
        const ranges = (window as any).fixture.editors['src/main.txt'].editor.getVisibleRanges();
        return ranges.some((range: any) => range.startLineNumber <= 7 && range.endLineNumber >= 9);
    })).toBe(true);
    expect(await page.evaluate(() => (window as any).fixture.editors['src/main.txt'].model.getValue())).toMatch(/^dirty /);
    await expect(page.getByRole('tab')).toHaveCount(2);
    await expect(page.getByRole('tab', { name: /main.txt/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Chat draft')).toHaveValue('keep this chat');
    await page.evaluate(() => (window as any).fixture.openCanvas());
    const canvasLink = page.getByTestId('canvas-panel-preview').getByRole('link', { name: 'Canvas source' });
    await expect(canvasLink).toHaveAttribute('href', 'src/main.txt#L13-L16');
    await canvasLink.click();
    await expect(page.getByRole('tab', { name: /main.txt/ })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => (window as any).fixture.editors['src/main.txt'].model
        .getAllDecorations().filter((d: any) => d.options.isWholeLine)
        .map((d: any) => [d.range.startLineNumber, d.range.endLineNumber]))).toContainEqual([13, 16]);
    await expect(page.getByRole('tab')).toHaveCount(3);
    expect(await page.evaluate(() => (window as any).fixture.editors['src/main.txt'].model.getValue())).toMatch(/^dirty /);
    expect(documents).toEqual(['http://markdown.test/']);
    expect(page.url()).toBe('http://markdown.test/');
    expect(errors).toEqual([]);
});
