/**
 * Table of Contents: buildToc, setupScrollSpy, updateActiveToc.
 *
 * Ported from deep-wiki toc.ts.
 * Adapted to use CoC's wiki-prefixed element IDs.
 */

export function buildToc(): void {
    const tocNav = document.getElementById('wiki-toc-nav');
    if (!tocNav) return;
    tocNav.innerHTML = '';
    const body = document.querySelector('#wiki-article-content .markdown-body');
    if (!body) return;

    const headings = body.querySelectorAll('h2, h3, h4');
    headings.forEach(function (heading) {
        if (!heading.id) return;
        const link = document.createElement('a');
        link.href = '#' + heading.id;
        link.textContent = (heading.textContent || '').replace(/#$/, '').trim();
        const level = heading.tagName.toLowerCase();
        if (level === 'h3') link.className = 'toc-h3';
        if (level === 'h4') link.className = 'toc-h4';
        link.onclick = function (e) {
            e.preventDefault();
            const target = document.getElementById(heading.id);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        };
        tocNav.appendChild(link);
    });

    setupScrollSpy();
}

export function setupScrollSpy(): void {
    const scrollEl = document.getElementById('wiki-content-scroll');
    if (!scrollEl) return;
    scrollEl.removeEventListener('scroll', updateActiveToc);
    scrollEl.addEventListener('scroll', updateActiveToc);
}

export function updateActiveToc(): void {
    const tocLinks = document.querySelectorAll('#wiki-toc-nav a');
    if (tocLinks.length === 0) return;

    const scrollEl = document.getElementById('wiki-content-scroll');
    if (!scrollEl) return;
    const scrollTop = scrollEl.scrollTop;
    let activeId: string | null = null;

    const headings = document.querySelectorAll('#wiki-article-content .markdown-body h2, #wiki-article-content .markdown-body h3, #wiki-article-content .markdown-body h4');
    headings.forEach(function (h) {
        if ((h as HTMLElement).offsetTop - 80 <= scrollTop) {
            activeId = h.id;
        }
    });

    tocLinks.forEach(function (link) {
        const href = link.getAttribute('href');
        if (href === '#' + activeId) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

(window as any).buildToc = buildToc;
