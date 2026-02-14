/**
 * Admin Portal Script Module
 *
 * Contains the admin portal functionality: tab switching, seeds/config editing,
 * save/reset operations, and status management.
 */

export function getAdminScript(): string {
    return `
        // ================================================================
        // Admin Portal (full page via SPA routing)
        // ================================================================

        var adminSeedsOriginal = '';
        var adminConfigOriginal = '';
        var adminInitialized = false;

        function showAdmin(skipHistory) {
            currentModuleId = null;
            showAdminContent();
            if (!skipHistory) {
                history.pushState({ type: 'admin' }, '', location.pathname + '#admin');
            }
            if (!adminInitialized) {
                initAdminEvents();
                adminInitialized = true;
            }
            loadAdminSeeds();
            loadAdminConfig();
        }

        document.getElementById('admin-toggle').addEventListener('click', function() {
            showAdmin(false);
        });

        document.getElementById('admin-back').addEventListener('click', function() {
            showHome(false);
        });

        function initAdminEvents() {
            // Tab switching
            document.querySelectorAll('.admin-tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    var target = this.getAttribute('data-tab');
                    document.querySelectorAll('.admin-tab').forEach(function(t) { t.classList.remove('active'); });
                    document.querySelectorAll('.admin-tab-content').forEach(function(c) { c.classList.remove('active'); });
                    this.classList.add('active');
                    document.getElementById('admin-content-' + target).classList.add('active');
                });
            });

            // Save seeds
            document.getElementById('seeds-save').addEventListener('click', async function() {
                clearAdminStatus('seeds');
                var text = document.getElementById('seeds-editor').value;
                var content;
                try {
                    content = JSON.parse(text);
                } catch (e) {
                    setAdminStatus('seeds', 'Invalid JSON: ' + e.message, true);
                    return;
                }
                try {
                    var res = await fetch('/api/admin/seeds', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: content })
                    });
                    var data = await res.json();
                    if (data.success) {
                        setAdminStatus('seeds', 'Saved', false);
                        adminSeedsOriginal = text;
                    } else {
                        setAdminStatus('seeds', data.error || 'Save failed', true);
                    }
                } catch (err) {
                    setAdminStatus('seeds', 'Error: ' + err.message, true);
                }
            });

            // Reset seeds
            document.getElementById('seeds-reset').addEventListener('click', function() {
                document.getElementById('seeds-editor').value = adminSeedsOriginal;
                clearAdminStatus('seeds');
            });

            // Save config
            document.getElementById('config-save').addEventListener('click', async function() {
                clearAdminStatus('config');
                var text = document.getElementById('config-editor').value;
                try {
                    var res = await fetch('/api/admin/config', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ content: text })
                    });
                    var data = await res.json();
                    if (data.success) {
                        setAdminStatus('config', 'Saved', false);
                        adminConfigOriginal = text;
                    } else {
                        setAdminStatus('config', data.error || 'Save failed', true);
                    }
                } catch (err) {
                    setAdminStatus('config', 'Error: ' + err.message, true);
                }
            });

            // Reset config
            document.getElementById('config-reset').addEventListener('click', function() {
                document.getElementById('config-editor').value = adminConfigOriginal;
                clearAdminStatus('config');
            });
        }

        function setAdminStatus(which, msg, isError) {
            var el = document.getElementById(which + '-status');
            el.textContent = msg;
            el.className = 'admin-file-status ' + (isError ? 'error' : 'success');
        }

        function clearAdminStatus(which) {
            var el = document.getElementById(which + '-status');
            el.textContent = '';
            el.className = 'admin-file-status';
        }

        async function loadAdminSeeds() {
            try {
                var res = await fetch('/api/admin/seeds');
                var data = await res.json();
                document.getElementById('seeds-path').textContent = data.path || 'seeds.json';
                if (data.exists && data.content) {
                    var text = JSON.stringify(data.content, null, 2);
                    document.getElementById('seeds-editor').value = text;
                    adminSeedsOriginal = text;
                } else if (data.exists && data.raw) {
                    document.getElementById('seeds-editor').value = data.raw;
                    adminSeedsOriginal = data.raw;
                } else {
                    document.getElementById('seeds-editor').value = '';
                    adminSeedsOriginal = '';
                }
            } catch (err) {
                setAdminStatus('seeds', 'Failed to load: ' + err.message, true);
            }
        }

        async function loadAdminConfig() {
            try {
                var res = await fetch('/api/admin/config');
                var data = await res.json();
                document.getElementById('config-path').textContent = data.path || 'deep-wiki.config.yaml';
                if (data.exists && data.content) {
                    document.getElementById('config-editor').value = data.content;
                    adminConfigOriginal = data.content;
                } else {
                    document.getElementById('config-editor').value = '';
                    adminConfigOriginal = '';
                }
            } catch (err) {
                setAdminStatus('config', 'Failed to load: ' + err.message, true);
            }
        }`;

}
