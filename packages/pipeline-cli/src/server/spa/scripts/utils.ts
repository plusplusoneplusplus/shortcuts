/**
 * Utility functions for the dashboard SPA.
 * Pure utility functions with no DOM dependencies.
 */
export function getUtilsScript(): string {
    return `
        // ================================================================
        // Utilities
        // ================================================================

        function formatDuration(ms) {
            if (ms == null || ms < 0) return '';
            if (ms < 1000) return '< 1s';
            var s = Math.floor(ms / 1000);
            var m = Math.floor(s / 60);
            var h = Math.floor(m / 60);
            s = s % 60;
            m = m % 60;
            if (h > 0) return h + 'h ' + m + 'm';
            if (m > 0) return m + 'm ' + s + 's';
            return s + 's';
        }

        function formatRelativeTime(dateStr) {
            if (!dateStr) return '';
            var d = new Date(dateStr);
            var now = Date.now();
            var diff = now - d.getTime();
            if (diff < 60000) return 'just now';
            var mins = Math.floor(diff / 60000);
            if (mins < 60) return mins + 'm ago';
            var hours = Math.floor(mins / 60);
            if (hours < 24) return hours + 'h ago';
            var days = Math.floor(hours / 24);
            if (days === 1) return 'yesterday';
            if (days < 7) return days + 'd ago';
            return d.toLocaleDateString();
        }

        function statusIcon(status) {
            var map = { running: '\\u{1F504}', completed: '\\u2705', failed: '\\u274C', cancelled: '\\u{1F6AB}', queued: '\\u23F3' };
            return map[status] || '';
        }

        function statusLabel(status) {
            var map = { running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', queued: 'Queued' };
            return map[status] || status || '';
        }

        function typeLabel(type) {
            var map = {
                'code-review': 'Code Review',
                'code-review-group': 'CR Group',
                'pipeline-execution': 'Pipeline',
                'pipeline-item': 'Pipeline Item',
                'clarification': 'Clarification',
                'discovery': 'Discovery'
            };
            return map[type] || type || '';
        }

        function copyToClipboard(text) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text);
            } else {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
        }

        function escapeHtmlClient(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
`;
}
