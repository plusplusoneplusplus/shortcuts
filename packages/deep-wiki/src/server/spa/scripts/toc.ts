/**
 * Table of Contents script: buildToc, setupScrollSpy, updateActiveToc.
 */
export function getTocScript(): string {
    return `
        // ================================================================
        // Table of Contents
        // ================================================================

        function buildToc() {
            var tocNav = document.getElementById('toc-nav');
            tocNav.innerHTML = '';
            var body = document.querySelector('#content .markdown-body');
            if (!body) return;

            var headings = body.querySelectorAll('h2, h3, h4');
            headings.forEach(function(heading) {
                if (!heading.id) return;
                var link = document.createElement('a');
                link.href = '#' + heading.id;
                link.textContent = heading.textContent.replace(/#$/, '').trim();
                var level = heading.tagName.toLowerCase();
                if (level === 'h3') link.className = 'toc-h3';
                if (level === 'h4') link.className = 'toc-h4';
                link.onclick = function(e) {
                    e.preventDefault();
                    var target = document.getElementById(heading.id);
                    if (target) {
                        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                };
                tocNav.appendChild(link);
            });

            // Scroll spy
            setupScrollSpy();
        }

        function setupScrollSpy() {
            var scrollEl = document.getElementById('content-scroll');
            if (!scrollEl) return;
            scrollEl.addEventListener('scroll', updateActiveToc);
        }

        function updateActiveToc() {
            var tocLinks = document.querySelectorAll('#toc-nav a');
            if (tocLinks.length === 0) return;

            var scrollEl = document.getElementById('content-scroll');
            var scrollTop = scrollEl.scrollTop;
            var activeId = null;

            var headings = document.querySelectorAll('#content .markdown-body h2, #content .markdown-body h3, #content .markdown-body h4');
            headings.forEach(function(h) {
                if (h.offsetTop - 80 <= scrollTop) {
                    activeId = h.id;
                }
            });

            tocLinks.forEach(function(link) {
                var href = link.getAttribute('href');
                if (href === '#' + activeId) {
                    link.classList.add('active');
                } else {
                    link.classList.remove('active');
                }
            });
        }
`;
}
