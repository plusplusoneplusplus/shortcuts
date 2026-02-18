"use strict";
(() => {
  // src/server/wiki/spa/client/core.ts
  var componentGraph = null;
  var currentComponentId = null;
  var currentTheme = window.__WIKI_CONFIG__?.defaultTheme ?? "auto";
  var markdownCache = {};
  function setCurrentComponentId(id) {
    currentComponentId = id;
  }
  function setCurrentTheme(theme) {
    currentTheme = theme;
  }
  async function init() {
    try {
      const res = await fetch("/api/graph");
      if (!res.ok) throw new Error("Failed to load component graph");
      componentGraph = await res.json();
      window.initTheme();
      window.initializeSidebar();
      window.showHome(true);
      history.replaceState({ type: "home" }, "", location.pathname);
    } catch (err) {
      const el = document.getElementById("content");
      if (el) {
        el.innerHTML = '<p style="color: red;">Error loading wiki data: ' + err.message + "</p>";
      }
    }
  }
  function setupPopstateHandler() {
    window.addEventListener("popstate", function(e) {
      const state = e.state;
      if (!state) {
        window.showHome(true);
        return;
      }
      if (state.type === "home") window.showHome(true);
      else if (state.type === "component" && state.id) window.loadComponent(state.id, true);
      else if (state.type === "special" && state.key && state.title) window.loadSpecialPage(state.key, state.title, true);
      else if (state.type === "theme" && state.themeId && state.slug) window.loadThemeArticle(state.themeId, state.slug, true);
      else if (state.type === "graph") {
        if (typeof window.showGraph === "function") window.showGraph(true);
        else window.showHome(true);
      } else if (state.type === "admin") window.showAdmin(true);
      else window.showHome(true);
    });
  }
  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // src/server/wiki/spa/client/theme.ts
  function initTheme() {
    const saved = localStorage.getItem("deep-wiki-theme");
    if (saved) {
      setCurrentTheme(saved);
      document.documentElement.setAttribute("data-theme", currentTheme);
    }
    updateThemeStyles();
  }
  function toggleTheme() {
    if (currentTheme === "auto") setCurrentTheme("dark");
    else if (currentTheme === "dark") setCurrentTheme("light");
    else setCurrentTheme("auto");
    document.documentElement.setAttribute("data-theme", currentTheme);
    localStorage.setItem("deep-wiki-theme", currentTheme);
    updateThemeStyles();
  }
  function updateThemeStyles() {
    const isDark = currentTheme === "dark" || currentTheme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const ls = document.getElementById("hljs-light");
    const ds = document.getElementById("hljs-dark");
    if (ls) ls.disabled = isDark;
    if (ds) ds.disabled = !isDark;
    const btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = isDark ? "\u2600" : "\u263E";
  }
  function updateSidebarCollapseBtn(isCollapsed) {
    const btn = document.getElementById("sidebar-collapse");
    if (!btn) return;
    if (isCollapsed) {
      btn.innerHTML = "&#x25B6;";
      btn.title = "Expand sidebar";
      btn.setAttribute("aria-label", "Expand sidebar");
    } else {
      btn.innerHTML = "&#x25C0;";
      btn.title = "Collapse sidebar";
      btn.setAttribute("aria-label", "Collapse sidebar");
    }
  }
  function setupThemeListeners() {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", updateThemeStyles);
    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) themeToggle.addEventListener("click", toggleTheme);
    const collapseBtn = document.getElementById("sidebar-collapse");
    if (collapseBtn) {
      collapseBtn.addEventListener("click", function() {
        const sidebar = document.getElementById("sidebar");
        if (!sidebar) return;
        const isCollapsed = sidebar.classList.toggle("collapsed");
        updateSidebarCollapseBtn(isCollapsed);
        localStorage.setItem("deep-wiki-sidebar-collapsed", isCollapsed ? "true" : "false");
      });
    }
    const saved = localStorage.getItem("deep-wiki-sidebar-collapsed");
    if (saved === "true") {
      const sidebar = document.getElementById("sidebar");
      if (sidebar) sidebar.classList.add("collapsed");
      updateSidebarCollapseBtn(true);
    }
  }

  // src/server/wiki/spa/client/sidebar.ts
  var config = window.__WIKI_CONFIG__;
  function initializeSidebar() {
    const topBarProject = document.getElementById("top-bar-project");
    if (topBarProject) topBarProject.textContent = componentGraph.project.name;
    const navContainer = document.getElementById("nav-container");
    if (!navContainer) return;
    const hasDomains = componentGraph.domains && componentGraph.domains.length > 0;
    const homeSection = document.createElement("div");
    homeSection.className = "nav-section";
    homeSection.innerHTML = '<div class="nav-item active" data-id="__home" onclick="showHome()"><span class="nav-item-name">Overview</span></div>' + (config.enableGraph ? '<div class="nav-item" data-id="__graph" onclick="showGraph()"><span class="nav-item-name">Dependency Graph</span></div>' : "");
    navContainer.appendChild(homeSection);
    if (hasDomains) {
      buildDomainSidebar(navContainer);
    } else {
      buildCategorySidebar(navContainer);
    }
    if (config.enableSearch) {
      const searchEl = document.getElementById("search");
      if (searchEl) {
        searchEl.addEventListener("input", function(e) {
          const query = e.target.value.toLowerCase();
          document.querySelectorAll(".nav-domain-component[data-id], .nav-item[data-id]").forEach(function(item) {
            const id = item.getAttribute("data-id");
            if (id === "__home" || id === "__graph") return;
            const text = item.textContent?.toLowerCase() ?? "";
            item.style.display = text.includes(query) ? "" : "none";
          });
          document.querySelectorAll(".nav-domain-group").forEach(function(group) {
            const visibleChildren = group.querySelectorAll('.nav-domain-component:not([style*="display: none"])');
            const domainItem = group.querySelector(".nav-domain-item");
            if (domainItem) domainItem.style.display = visibleChildren.length === 0 ? "none" : "";
            const childrenEl = group.querySelector(".nav-domain-children");
            if (childrenEl) childrenEl.style.display = visibleChildren.length === 0 ? "none" : "";
          });
          document.querySelectorAll(".nav-section").forEach(function(section) {
            const title = section.querySelector(".nav-section-title");
            if (!title) return;
            const visible = section.querySelectorAll('.nav-item[data-id]:not([style*="display: none"])');
            title.style.display = visible.length === 0 ? "none" : "";
          });
        });
      }
    }
  }
  function buildDomainSidebar(navContainer) {
    const domainMap = {};
    componentGraph.domains.forEach(function(domain) {
      domainMap[area.id] = area;
    });
    const domainComponents = {};
    componentGraph.domains.forEach(function(domain) {
      domainComponents[area.id] = [];
    });
    componentGraph.components.forEach(function(mod) {
      const domainId = mod.domain;
      if (domainId && domainComponents[domainId]) {
        domainComponents[domainId].push(mod);
      } else {
        let found = false;
        componentGraph.domains.forEach(function(domain) {
          if (area.components && area.components.indexOf(mod.id) !== -1) {
            domainComponents[area.id].push(mod);
            found = true;
          }
        });
        if (!found) {
          if (!domainComponents["__other"]) domainComponents["__other"] = [];
          domainComponents["__other"].push(mod);
        }
      }
    });
    componentGraph.domains.forEach(function(domain) {
      const components = domainComponents[area.id] || [];
      if (components.length === 0) return;
      const group = document.createElement("div");
      group.className = "nav-area-group";
      const domainItem = document.createElement("div");
      domainItem.className = "nav-area-item";
      domainItem.setAttribute("data-domain-id", area.id);
      domainItem.innerHTML = '<span class="nav-item-name">' + escapeHtml(area.name) + "</span>";
      group.appendChild(domainItem);
      const childrenEl = document.createElement("div");
      childrenEl.className = "nav-area-children";
      components.forEach(function(mod) {
        const item = document.createElement("div");
        item.className = "nav-area-component";
        item.setAttribute("data-id", mod.id);
        item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + "</span>";
        item.onclick = function() {
          window.loadComponent(mod.id);
        };
        childrenEl.appendChild(item);
      });
      group.appendChild(childrenEl);
      navContainer.appendChild(group);
    });
    const otherComponents = domainComponents["__other"] || [];
    if (otherComponents.length > 0) {
      const group = document.createElement("div");
      group.className = "nav-area-group";
      const domainItem = document.createElement("div");
      domainItem.className = "nav-area-item";
      domainItem.innerHTML = '<span class="nav-item-name">Other</span>';
      group.appendChild(domainItem);
      const childrenEl = document.createElement("div");
      childrenEl.className = "nav-area-children";
      otherComponents.forEach(function(mod) {
        const item = document.createElement("div");
        item.className = "nav-area-component";
        item.setAttribute("data-id", mod.id);
        item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + "</span>";
        item.onclick = function() {
          window.loadComponent(mod.id);
        };
        childrenEl.appendChild(item);
      });
      group.appendChild(childrenEl);
      navContainer.appendChild(group);
    }
    buildThemesSidebar(navContainer);
  }
  function buildCategorySidebar(navContainer) {
    const categories = {};
    componentGraph.components.forEach(function(mod) {
      const cat = mod.category || "other";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(mod);
    });
    Object.keys(categories).sort().forEach(function(category) {
      const group = document.createElement("div");
      group.className = "nav-area-group";
      const catItem = document.createElement("div");
      catItem.className = "nav-area-item";
      catItem.innerHTML = '<span class="nav-item-name">' + escapeHtml(category) + "</span>";
      group.appendChild(catItem);
      const childrenEl = document.createElement("div");
      childrenEl.className = "nav-area-children";
      categories[category].forEach(function(mod) {
        const item = document.createElement("div");
        item.className = "nav-area-component";
        item.setAttribute("data-id", mod.id);
        item.innerHTML = '<span class="nav-item-name">' + escapeHtml(mod.name) + "</span>";
        item.onclick = function() {
          window.loadComponent(mod.id);
        };
        childrenEl.appendChild(item);
      });
      group.appendChild(childrenEl);
      navContainer.appendChild(group);
    });
    buildThemesSidebar(navContainer);
  }
  function buildThemesSidebar(navContainer) {
    const themes = componentGraph.themes;
    if (!themes || themes.length === 0) return;
    const divider = document.createElement("div");
    divider.className = "nav-section-title";
    divider.textContent = "Themes";
    divider.setAttribute("data-section", "themes");
    navContainer.appendChild(divider);
    themes.forEach(function(theme) {
      if (theme.layout === "area" && theme.articles.length > 1) {
        const group = document.createElement("div");
        group.className = "nav-area-group nav-theme-group";
        const themeItem = document.createElement("div");
        themeItem.className = "nav-area-item";
        themeItem.setAttribute("data-theme-id", theme.id);
        themeItem.innerHTML = '<span class="nav-item-name">\u{1F4CB} ' + escapeHtml(theme.title) + "</span>";
        group.appendChild(themeItem);
        const childrenEl = document.createElement("div");
        childrenEl.className = "nav-area-children";
        theme.articles.forEach(function(article) {
          const item = document.createElement("div");
          item.className = "nav-area-component nav-theme-article";
          item.setAttribute("data-id", "theme:" + theme.id + ":" + article.slug);
          item.innerHTML = '<span class="nav-item-name">' + escapeHtml(article.title) + "</span>";
          item.onclick = function() {
            window.loadThemeArticle(theme.id, article.slug);
          };
          childrenEl.appendChild(item);
        });
        group.appendChild(childrenEl);
        navContainer.appendChild(group);
      } else {
        const slug = theme.articles.length > 0 ? theme.articles[0].slug : theme.id;
        const item = document.createElement("div");
        item.className = "nav-item nav-theme-article";
        item.setAttribute("data-id", "theme:" + theme.id + ":" + slug);
        item.innerHTML = '<span class="nav-item-name">\u{1F4CB} ' + escapeHtml(theme.title) + "</span>";
        item.onclick = function() {
          window.loadThemeArticle(theme.id, slug);
        };
        navContainer.appendChild(item);
      }
    });
  }
  function setActive(id) {
    document.querySelectorAll(".nav-item, .nav-area-component, .nav-domain-item").forEach(function(el) {
      el.classList.remove("active");
    });
    const target = document.querySelector('.nav-item[data-id="' + id + '"]') || document.querySelector('.nav-area-component[data-id="' + id + '"]');
    if (target) target.classList.add("active");
  }
  function showWikiContent() {
    const contentScroll = document.getElementById("content-scroll");
    if (contentScroll) contentScroll.style.display = "";
    const adminPage = document.getElementById("admin-page");
    if (adminPage) adminPage.classList.add("hidden");
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.style.display = "";
    const askWidget = document.getElementById("ask-widget");
    if (askWidget) askWidget.style.display = "";
  }
  function showAdminContent() {
    const contentScroll = document.getElementById("content-scroll");
    if (contentScroll) contentScroll.style.display = "none";
    const adminPage = document.getElementById("admin-page");
    if (adminPage) adminPage.classList.remove("hidden");
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.style.display = "none";
    const askWidget = document.getElementById("ask-widget");
    if (askWidget) askWidget.style.display = "none";
  }

  // src/server/wiki/spa/client/content.ts
  var config2 = window.__WIKI_CONFIG__;
  function showHome(skipHistory) {
    setCurrentComponentId(null);
    setActive("__home");
    showWikiContent();
    const tocNav = document.getElementById("toc-nav");
    if (tocNav) tocNav.innerHTML = "";
    if (!skipHistory) {
      history.pushState({ type: "home" }, "", location.pathname);
    }
    if (config2.enableAI) {
      window.updateAskSubject(componentGraph.project.name);
    }
    const stats = {
      components: componentGraph.components.length,
      categories: (componentGraph.categories || []).length,
      language: componentGraph.project.language,
      buildSystem: componentGraph.project.buildSystem
    };
    let html = '<div class="home-view"><h1>' + escapeHtml(componentGraph.project.name) + '</h1><p style="font-size: 15px; color: var(--content-muted); margin-bottom: 24px;">' + escapeHtml(componentGraph.project.description) + '</p><div class="project-stats"><div class="stat-card"><h3>Components</h3><div class="value">' + stats.components + '</div></div><div class="stat-card"><h3>Categories</h3><div class="value">' + stats.categories + '</div></div><div class="stat-card"><h3>Language</h3><div class="value small">' + escapeHtml(stats.language) + '</div></div><div class="stat-card"><h3>Build System</h3><div class="value small">' + escapeHtml(stats.buildSystem) + "</div></div></div>";
    const hasDomains = componentGraph.domains && componentGraph.domains.length > 0;
    if (hasDomains) {
      componentGraph.domains.forEach(function(domain) {
        const domainComponents = componentGraph.components.filter(function(mod) {
          if (mod.domain === area.id) return true;
          return area.components && area.components.indexOf(mod.id) !== -1;
        });
        if (domainComponents.length === 0) return;
        html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">' + escapeHtml(area.name) + "</h3>";
        if (area.description) {
          html += '<p style="color: var(--content-muted); margin-bottom: 12px; font-size: 14px;">' + escapeHtml(area.description) + "</p>";
        }
        html += '<div class="component-grid">';
        domainComponents.forEach(function(mod) {
          html += `<div class="component-card" onclick="loadComponent('` + mod.id.replace(/'/g, "\\'") + `')"><h4>` + escapeHtml(mod.name) + ' <span class="complexity-badge complexity-' + mod.complexity + '">' + mod.complexity + "</span></h4><p>" + escapeHtml(mod.purpose) + "</p></div>";
        });
        html += "</div>";
      });
      const assignedIds = /* @__PURE__ */ new Set();
      componentGraph.domains.forEach(function(domain) {
        componentGraph.components.forEach(function(mod) {
          if (mod.domain === area.id || area.components && area.components.indexOf(mod.id) !== -1) {
            assignedIds.add(mod.id);
          }
        });
      });
      const unassigned = componentGraph.components.filter(function(mod) {
        return !assignedIds.has(mod.id);
      });
      if (unassigned.length > 0) {
        html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">Other</h3><div class="component-grid">';
        unassigned.forEach(function(mod) {
          html += `<div class="component-card" onclick="loadComponent('` + mod.id.replace(/'/g, "\\'") + `')"><h4>` + escapeHtml(mod.name) + ' <span class="complexity-badge complexity-' + mod.complexity + '">' + mod.complexity + "</span></h4><p>" + escapeHtml(mod.purpose) + "</p></div>";
        });
        html += "</div>";
      }
    } else {
      html += '<h3 style="margin-top: 24px; margin-bottom: 12px;">All Components</h3><div class="component-grid">';
      componentGraph.components.forEach(function(mod) {
        html += `<div class="component-card" onclick="loadComponent('` + mod.id.replace(/'/g, "\\'") + `')"><h4>` + escapeHtml(mod.name) + ' <span class="complexity-badge complexity-' + mod.complexity + '">' + mod.complexity + "</span></h4><p>" + escapeHtml(mod.purpose) + "</p></div>";
      });
      html += "</div>";
    }
    html += "</div>";
    const contentEl = document.getElementById("content");
    if (contentEl) contentEl.innerHTML = html;
    const contentScroll = document.getElementById("content-scroll");
    if (contentScroll) contentScroll.scrollTop = 0;
  }
  async function loadComponent(componentId, skipHistory) {
    const mod = componentGraph.components.find(function(m) {
      return m.id === componentId;
    });
    if (!mod) return;
    setCurrentComponentId(componentId);
    setActive(componentId);
    showWikiContent();
    if (!skipHistory) {
      history.pushState({ type: "component", id: componentId }, "", location.pathname + "#component-" + encodeURIComponent(componentId));
    }
    if (config2.enableAI) {
      window.updateAskSubject(mod.name);
    }
    if (markdownCache[componentId]) {
      renderComponentPage(mod, markdownCache[componentId]);
      const contentScroll2 = document.getElementById("content-scroll");
      if (contentScroll2) contentScroll2.scrollTop = 0;
      return;
    }
    const contentEl = document.getElementById("content");
    if (contentEl) contentEl.innerHTML = '<div class="loading">Loading component...</div>';
    try {
      const res = await fetch("/api/components/" + encodeURIComponent(componentId));
      if (!res.ok) throw new Error("Failed to load component");
      const data = await res.json();
      if (data.markdown) {
        markdownCache[componentId] = data.markdown;
        renderComponentPage(mod, data.markdown);
      } else {
        if (contentEl) {
          contentEl.innerHTML = '<div class="markdown-body"><h2>' + escapeHtml(mod.name) + "</h2><p>" + escapeHtml(mod.purpose) + "</p></div>";
        }
      }
    } catch (err) {
      if (contentEl) {
        contentEl.innerHTML = '<p style="color: red;">Error loading component: ' + err.message + "</p>";
      }
    }
    const contentScroll = document.getElementById("content-scroll");
    if (contentScroll) contentScroll.scrollTop = 0;
  }
  function renderComponentPage(mod, markdown) {
    let html = "";
    html += `<div class="component-page-header" style="overflow: hidden; margin-bottom: 8px;"><button class="component-regen-btn" id="component-regen-btn" onclick="regenerateComponent('` + mod.id.replace(/'/g, "\\'") + `')" style="display: none;" title="Regenerate this component\u2019s article using the latest analysis">&#x1F504; Regenerate</button></div>`;
    if (mod.keyFiles && mod.keyFiles.length > 0) {
      html += '<div class="source-files-section" id="source-files"><button class="source-files-toggle" onclick="toggleSourceFiles()"><span class="source-files-arrow">&#x25B6;</span> Relevant source files</button><div class="source-files-list">';
      mod.keyFiles.forEach(function(f) {
        html += '<span class="source-pill"><span class="source-pill-icon">&#9671;</span> ' + escapeHtml(f) + "</span>";
      });
      html += "</div></div>";
    }
    html += '<div class="markdown-body" id="component-article-body">' + marked.parse(markdown) + "</div>";
    const contentEl = document.getElementById("content");
    if (contentEl) contentEl.innerHTML = html;
    window.processMarkdownContent();
    window.buildToc();
    if (config2.enableAI) {
      window.addDeepDiveButton(mod.id);
    }
    checkRegenAvailability();
  }
  var regenAvailable = null;
  async function checkRegenAvailability() {
    try {
      if (regenAvailable === null) {
        const res = await fetch("/api/admin/generate/status");
        const data = await res.json();
        regenAvailable = data.available || false;
      }
      const btn = document.getElementById("component-regen-btn");
      if (btn && regenAvailable) {
        btn.style.display = "";
      }
    } catch (_e) {
    }
  }
  async function regenerateComponent(componentId) {
    const btn = document.getElementById("component-regen-btn");
    if (!btn || btn.disabled) return;
    if (!confirm("Regenerate the article for this component?\nThis will replace the current article with a freshly generated one.")) return;
    btn.disabled = true;
    btn.innerHTML = "&#x23F3; Regenerating\u2026";
    btn.classList.add("regen-running");
    const articleBody = document.getElementById("component-article-body");
    if (articleBody) {
      articleBody.classList.add("regen-overlay");
      const overlayText = document.createElement("div");
      overlayText.className = "regen-overlay-text";
      overlayText.textContent = "Regenerating article\u2026";
      articleBody.appendChild(overlayText);
    }
    try {
      const response = await fetch("/api/admin/generate/component/" + encodeURIComponent(componentId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false })
      });
      if (!response.ok && response.headers.get("content-type")?.indexOf("text/event-stream") === -1) {
        const errData = await response.json();
        throw new Error(errData.error || "Generation failed (HTTP " + response.status + ")");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let success = false;
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.substring(6));
            if (event.type === "done") {
              success = event.success;
            }
            if (event.type === "error") {
              throw new Error(event.message || "Generation error");
            }
          } catch (parseErr) {
            if (parseErr.message && parseErr.message !== "Generation error") continue;
            throw parseErr;
          }
        }
      }
      if (success) {
        btn.innerHTML = "&#x2705; Regenerated";
        btn.classList.remove("regen-running");
        btn.classList.add("regen-success");
        delete markdownCache[componentId];
        setTimeout(function() {
          loadComponent(componentId, true);
        }, 800);
      } else {
        throw new Error("Generation completed without success");
      }
    } catch (err) {
      btn.innerHTML = "&#x1F504; Regenerate";
      btn.classList.remove("regen-running");
      btn.disabled = false;
      if (articleBody) {
        articleBody.classList.remove("regen-overlay");
        const ot = articleBody.querySelector(".regen-overlay-text");
        if (ot) ot.remove();
      }
      alert("Regeneration failed: " + err.message);
    }
  }
  function toggleSourceFiles() {
    const section = document.getElementById("source-files");
    if (section) section.classList.toggle("expanded");
  }
  async function loadSpecialPage(key, title, skipHistory) {
    setCurrentComponentId(null);
    setActive(key);
    showWikiContent();
    if (!skipHistory) {
      history.pushState({ type: "special", key, title }, "", location.pathname + "#" + encodeURIComponent(key));
    }
    const cacheKey = "__page_" + key;
    if (markdownCache[cacheKey]) {
      window.renderMarkdownContent(markdownCache[cacheKey]);
      window.buildToc();
      const contentScroll2 = document.getElementById("content-scroll");
      if (contentScroll2) contentScroll2.scrollTop = 0;
      return;
    }
    const contentEl = document.getElementById("content");
    if (contentEl) contentEl.innerHTML = '<div class="loading">Loading page...</div>';
    try {
      const res = await fetch("/api/pages/" + encodeURIComponent(key));
      if (!res.ok) throw new Error("Page not found");
      const data = await res.json();
      markdownCache[cacheKey] = data.markdown;
      window.renderMarkdownContent(data.markdown);
      window.buildToc();
    } catch (_err) {
      if (contentEl) contentEl.innerHTML = "<p>Content not available.</p>";
    }
    const contentScroll = document.getElementById("content-scroll");
    if (contentScroll) contentScroll.scrollTop = 0;
  }
  async function loadThemeArticle(themeId, slug, skipHistory) {
    setCurrentComponentId(null);
    const navId = "theme:" + themeId + ":" + slug;
    setActive(navId);
    showWikiContent();
    if (!skipHistory) {
      history.pushState({ type: "theme", themeId, slug }, "", location.pathname + "#theme-" + encodeURIComponent(themeId) + "-" + encodeURIComponent(slug));
    }
    if (config2.enableAI) {
      window.updateAskSubject(themeId + "/" + slug);
    }
    const cacheKey = "__theme_" + themeId + "_" + slug;
    if (markdownCache[cacheKey]) {
      window.renderMarkdownContent(markdownCache[cacheKey]);
      window.buildToc();
      const contentScroll2 = document.getElementById("content-scroll");
      if (contentScroll2) contentScroll2.scrollTop = 0;
      return;
    }
    const contentEl = document.getElementById("content");
    if (contentEl) contentEl.innerHTML = '<div class="loading">Loading theme article...</div>';
    try {
      const res = await fetch("/api/themes/" + encodeURIComponent(themeId) + "/" + encodeURIComponent(slug));
      if (!res.ok) throw new Error("Theme article not found");
      const data = await res.json();
      markdownCache[cacheKey] = data.content;
      window.renderMarkdownContent(data.content);
      window.buildToc();
    } catch (err) {
      if (contentEl) {
        contentEl.innerHTML = '<p style="color: red;">Error loading theme article: ' + err.message + "</p>";
      }
    }
    const contentScroll = document.getElementById("content-scroll");
    if (contentScroll) contentScroll.scrollTop = 0;
  }

  // src/server/wiki/spa/client/mermaid-zoom.ts
  var MERMAID_MIN_ZOOM = 0.25;
  var MERMAID_MAX_ZOOM = 4;
  var MERMAID_ZOOM_STEP = 0.25;
  function initMermaidZoom() {
    document.querySelectorAll(".mermaid-container").forEach(function(container) {
      const viewport = container.querySelector(".mermaid-viewport");
      const svgWrapper = container.querySelector(".mermaid-svg-wrapper");
      if (!viewport || !svgWrapper) return;
      const state = {
        scale: 1,
        translateX: 0,
        translateY: 0,
        isDragging: false,
        dragStartX: 0,
        dragStartY: 0,
        lastTX: 0,
        lastTY: 0
      };
      function applyTransform() {
        svgWrapper.style.transform = "translate(" + state.translateX + "px, " + state.translateY + "px) scale(" + state.scale + ")";
        const display = container.querySelector(".mermaid-zoom-level");
        if (display) display.textContent = Math.round(state.scale * 100) + "%";
      }
      const zoomInBtn = container.querySelector(".mermaid-zoom-in");
      if (zoomInBtn) {
        zoomInBtn.addEventListener("click", function(e) {
          e.stopPropagation();
          state.scale = Math.min(MERMAID_MAX_ZOOM, state.scale + MERMAID_ZOOM_STEP);
          applyTransform();
        });
      }
      const zoomOutBtn = container.querySelector(".mermaid-zoom-out");
      if (zoomOutBtn) {
        zoomOutBtn.addEventListener("click", function(e) {
          e.stopPropagation();
          state.scale = Math.max(MERMAID_MIN_ZOOM, state.scale - MERMAID_ZOOM_STEP);
          applyTransform();
        });
      }
      const resetBtn = container.querySelector(".mermaid-zoom-reset");
      if (resetBtn) {
        resetBtn.addEventListener("click", function(e) {
          e.stopPropagation();
          state.scale = 1;
          state.translateX = 0;
          state.translateY = 0;
          applyTransform();
        });
      }
      viewport.addEventListener("wheel", function(e) {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY > 0 ? -MERMAID_ZOOM_STEP : MERMAID_ZOOM_STEP;
        const newScale = Math.max(MERMAID_MIN_ZOOM, Math.min(MERMAID_MAX_ZOOM, state.scale + delta));
        if (newScale !== state.scale) {
          const rect = viewport.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const px = (mx - state.translateX) / state.scale;
          const py = (my - state.translateY) / state.scale;
          state.scale = newScale;
          state.translateX = mx - px * state.scale;
          state.translateY = my - py * state.scale;
          applyTransform();
        }
      }, { passive: false });
      viewport.addEventListener("mousedown", function(e) {
        if (e.button !== 0) return;
        state.isDragging = true;
        state.dragStartX = e.clientX;
        state.dragStartY = e.clientY;
        state.lastTX = state.translateX;
        state.lastTY = state.translateY;
        viewport.classList.add("mermaid-dragging");
        e.preventDefault();
      });
      document.addEventListener("mousemove", function(e) {
        if (!state.isDragging) return;
        state.translateX = state.lastTX + (e.clientX - state.dragStartX);
        state.translateY = state.lastTY + (e.clientY - state.dragStartY);
        applyTransform();
      });
      document.addEventListener("mouseup", function() {
        if (!state.isDragging) return;
        state.isDragging = false;
        viewport.classList.remove("mermaid-dragging");
      });
    });
  }

  // src/server/wiki/spa/client/markdown.ts
  function renderMarkdownContent(markdown) {
    const html = marked.parse(markdown);
    const container = document.getElementById("content");
    if (container) {
      container.innerHTML = '<div class="markdown-body">' + html + "</div>";
    }
    processMarkdownContent();
  }
  function processMarkdownContent() {
    const container = document.getElementById("content");
    if (!container) return;
    const body = container.querySelector(".markdown-body");
    if (!body) return;
    body.querySelectorAll("pre code").forEach(function(block) {
      if (block.classList.contains("language-mermaid")) {
        const pre = block.parentElement;
        if (!pre) return;
        const mermaidCode = block.textContent || "";
        const mContainer = document.createElement("div");
        mContainer.className = "mermaid-container";
        mContainer.innerHTML = '<div class="mermaid-toolbar"><span class="mermaid-toolbar-label">Diagram</span><button class="mermaid-zoom-btn mermaid-zoom-out" title="Zoom out">\u2212</button><span class="mermaid-zoom-level">100%</span><button class="mermaid-zoom-btn mermaid-zoom-in" title="Zoom in">+</button><button class="mermaid-zoom-btn mermaid-zoom-reset" title="Reset view">\u27F2</button></div><div class="mermaid-viewport"><div class="mermaid-svg-wrapper"><pre class="mermaid">' + mermaidCode + "</pre></div></div>";
        pre.parentNode.replaceChild(mContainer, pre);
      } else {
        hljs.highlightElement(block);
        addCopyButton(block.parentElement);
      }
    });
    body.querySelectorAll("h1, h2, h3, h4").forEach(function(heading) {
      const id = (heading.textContent || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      heading.id = id;
      const anchor = document.createElement("a");
      anchor.className = "heading-anchor";
      anchor.href = "#" + id;
      anchor.textContent = "#";
      heading.appendChild(anchor);
    });
    initMermaid();
    body.addEventListener("click", function(e) {
      let target = e.target;
      while (target && target !== body) {
        if (target.tagName === "A") break;
        target = target.parentElement;
      }
      if (!target || target.tagName !== "A") return;
      let href = target.getAttribute("href");
      if (!href || !href.match(/\.md(#.*)?$/)) return;
      if (/^https?:\/\//.test(href)) return;
      e.preventDefault();
      let hashPart = "";
      const hashIdx = href.indexOf("#");
      if (hashIdx !== -1) {
        hashPart = href.substring(hashIdx + 1);
        href = href.substring(0, hashIdx);
      }
      const slug = href.replace(/^(\.\.\/|\.\/)+/g, "").replace(/^domains\/[^/]+\/components\//, "").replace(/^domains\/[^/]+\//, "").replace(/^components\//, "").replace(/\.md$/, "");
      const specialPages = {
        "index": { key: "__index", title: "Index" },
        "architecture": { key: "__architecture", title: "Architecture" },
        "getting-started": { key: "__getting-started", title: "Getting Started" }
      };
      if (specialPages[slug]) {
        window.loadSpecialPage(specialPages[slug].key, specialPages[slug].title);
        return;
      }
      const matchedId = findComponentIdBySlugClient(slug);
      if (matchedId) {
        window.loadComponent(matchedId);
        if (hashPart) {
          setTimeout(function() {
            const el = document.getElementById(hashPart);
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }, 100);
        }
      }
    });
  }
  function findComponentIdBySlugClient(slug) {
    const normalized = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    for (let i = 0; i < componentGraph.components.length; i++) {
      const mod = componentGraph.components[i];
      const modSlug = mod.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (modSlug === normalized) return mod.id;
    }
    return null;
  }
  function addCopyButton(pre) {
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.onclick = function() {
      const code = pre.querySelector("code");
      const text = code ? code.textContent || "" : pre.textContent || "";
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = "Copied!";
        setTimeout(function() {
          btn.textContent = "Copy";
        }, 2e3);
      });
    };
    pre.appendChild(btn);
  }
  function initMermaid() {
    const blocks = document.querySelectorAll(".mermaid");
    if (blocks.length === 0) return Promise.resolve();
    const isDark = currentTheme === "dark" || currentTheme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? "dark" : "default",
      securityLevel: "loose",
      flowchart: { useMaxWidth: false, htmlLabels: true, curve: "basis" },
      fontSize: 14
    });
    return mermaid.run({ nodes: blocks }).then(function() {
      initMermaidZoom();
    });
  }

  // src/server/wiki/spa/client/toc.ts
  function buildToc() {
    const tocNav = document.getElementById("toc-nav");
    if (!tocNav) return;
    tocNav.innerHTML = "";
    const body = document.querySelector("#content .markdown-body");
    if (!body) return;
    const headings = body.querySelectorAll("h2, h3, h4");
    headings.forEach(function(heading) {
      if (!heading.id) return;
      const link = document.createElement("a");
      link.href = "#" + heading.id;
      link.textContent = (heading.textContent || "").replace(/#$/, "").trim();
      const level = heading.tagName.toLowerCase();
      if (level === "h3") link.className = "toc-h3";
      if (level === "h4") link.className = "toc-h4";
      link.onclick = function(e) {
        e.preventDefault();
        const target = document.getElementById(heading.id);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };
      tocNav.appendChild(link);
    });
    setupScrollSpy();
  }
  function setupScrollSpy() {
    const scrollEl = document.getElementById("content-scroll");
    if (!scrollEl) return;
    scrollEl.addEventListener("scroll", updateActiveToc);
  }
  function updateActiveToc() {
    const tocLinks = document.querySelectorAll("#toc-nav a");
    if (tocLinks.length === 0) return;
    const scrollEl = document.getElementById("content-scroll");
    if (!scrollEl) return;
    const scrollTop = scrollEl.scrollTop;
    let activeId = null;
    const headings = document.querySelectorAll("#content .markdown-body h2, #content .markdown-body h3, #content .markdown-body h4");
    headings.forEach(function(h) {
      if (h.offsetTop - 80 <= scrollTop) {
        activeId = h.id;
      }
    });
    tocLinks.forEach(function(link) {
      const href = link.getAttribute("href");
      if (href === "#" + activeId) {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });
  }

  // src/server/wiki/spa/client/graph.ts
  var graphRendered = false;
  var disabledCategories = /* @__PURE__ */ new Set();
  var CATEGORY_COLORS = [
    "#3b82f6",
    "#ef4444",
    "#22c55e",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#f97316",
    "#14b8a6",
    "#6366f1"
  ];
  var COMPLEXITY_RADIUS = { low: 8, medium: 12, high: 18 };
  function getCategoryColor(category, allCategories) {
    const idx = allCategories.indexOf(category);
    return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
  }
  function showGraph(skipHistory) {
    setCurrentComponentId(null);
    setActive("__graph");
    const tocNav = document.getElementById("toc-nav");
    if (tocNav) tocNav.innerHTML = "";
    if (!skipHistory) {
      history.pushState({ type: "graph" }, "", location.pathname + "#graph");
    }
    const article = document.getElementById("article");
    article.style.maxWidth = "100%";
    article.style.padding = "0";
    const container = document.getElementById("content");
    container.innerHTML = '<div class="graph-container" id="graph-container"><div class="graph-toolbar"><button id="graph-zoom-in" title="Zoom in">+</button><button id="graph-zoom-out" title="Zoom out">\u2212</button><button id="graph-zoom-reset" title="Reset view">Reset</button></div><div class="graph-legend" id="graph-legend"></div><div class="graph-tooltip" id="graph-tooltip" style="display:none;"></div></div>';
    const gc = document.getElementById("graph-container");
    gc.style.height = article.parentElement.parentElement.clientHeight - 48 + "px";
    renderGraph();
  }
  function renderGraph() {
    if (typeof d3 === "undefined") return;
    const container = document.getElementById("graph-container");
    if (!container) return;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;
    const allCategories = [];
    componentGraph.components.forEach(function(m) {
      if (allCategories.indexOf(m.category) === -1) allCategories.push(m.category);
    });
    allCategories.sort();
    const legendEl = document.getElementById("graph-legend");
    legendEl.innerHTML = '<div class="graph-legend-title">Categories</div>';
    allCategories.forEach(function(cat) {
      const color = getCategoryColor(cat, allCategories);
      const item = document.createElement("div");
      item.className = "graph-legend-item";
      item.setAttribute("data-category", cat);
      item.innerHTML = '<div class="graph-legend-swatch" style="background:' + color + '"></div><span>' + escapeHtml(cat) + "</span>";
      item.onclick = function() {
        if (disabledCategories.has(cat)) {
          disabledCategories.delete(cat);
          item.classList.remove("disabled");
        } else {
          disabledCategories.add(cat);
          item.classList.add("disabled");
        }
        updateGraphVisibility();
      };
      legendEl.appendChild(item);
    });
    const nodes = componentGraph.components.map(function(m) {
      return { id: m.id, name: m.name, category: m.category, complexity: m.complexity, path: m.path, purpose: m.purpose };
    });
    const nodeIds = new Set(nodes.map(function(n) {
      return n.id;
    }));
    const links = [];
    componentGraph.components.forEach(function(m) {
      (m.dependencies || []).forEach(function(dep) {
        if (nodeIds.has(dep)) {
          links.push({ source: m.id, target: dep });
        }
      });
    });
    const svg = d3.select("#graph-container").append("svg").attr("width", width).attr("height", height);
    svg.append("defs").append("marker").attr("id", "arrowhead").attr("viewBox", "0 -5 10 10").attr("refX", 20).attr("refY", 0).attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto").append("path").attr("d", "M0,-5L10,0L0,5").attr("class", "graph-link-arrow");
    const g = svg.append("g");
    const link = g.selectAll(".graph-link").data(links).join("line").attr("class", "graph-link").attr("marker-end", "url(#arrowhead)");
    const node = g.selectAll(".graph-node").data(nodes).join("g").attr("class", "graph-node").style("cursor", "pointer").call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended));
    node.append("circle").attr("r", function(d) {
      return COMPLEXITY_RADIUS[d.complexity] || 10;
    }).attr("fill", function(d) {
      return getCategoryColor(d.category, allCategories);
    }).attr("stroke", "#fff").attr("stroke-width", 1.5);
    node.append("text").attr("dx", function(d) {
      return (COMPLEXITY_RADIUS[d.complexity] || 10) + 4;
    }).attr("dy", 4).text(function(d) {
      return d.name;
    });
    node.on("click", function(event, d) {
      event.stopPropagation();
      const articleEl = document.getElementById("article");
      if (articleEl) {
        articleEl.style.maxWidth = "";
        articleEl.style.padding = "";
      }
      window.loadComponent(d.id);
    });
    const tooltip = document.getElementById("graph-tooltip");
    node.on("mouseover", function(_event, d) {
      tooltip.style.display = "block";
      tooltip.innerHTML = '<div class="graph-tooltip-name">' + escapeHtml(d.name) + '</div><div class="graph-tooltip-purpose">' + escapeHtml(d.purpose) + '</div><div style="margin-top:4px;font-size:11px;color:var(--content-muted);">Complexity: ' + d.complexity + "</div>";
    });
    node.on("mousemove", function(event) {
      tooltip.style.left = event.pageX + 12 + "px";
      tooltip.style.top = event.pageY - 12 + "px";
    });
    node.on("mouseout", function() {
      tooltip.style.display = "none";
    });
    const simulation = d3.forceSimulation(nodes).force("link", d3.forceLink(links).id(function(d) {
      return d.id;
    }).distance(100)).force("charge", d3.forceManyBody().strength(-300)).force("center", d3.forceCenter(width / 2, height / 2)).force("collision", d3.forceCollide().radius(function(d) {
      return (COMPLEXITY_RADIUS[d.complexity] || 10) + 8;
    })).on("tick", function() {
      link.attr("x1", function(d) {
        return d.source.x;
      }).attr("y1", function(d) {
        return d.source.y;
      }).attr("x2", function(d) {
        return d.target.x;
      }).attr("y2", function(d) {
        return d.target.y;
      });
      node.attr("transform", function(d) {
        return "translate(" + d.x + "," + d.y + ")";
      });
    });
    const zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", function(event) {
      g.attr("transform", event.transform);
    });
    svg.call(zoom);
    const zoomInBtn = document.getElementById("graph-zoom-in");
    if (zoomInBtn) zoomInBtn.onclick = function() {
      svg.transition().call(zoom.scaleBy, 1.3);
    };
    const zoomOutBtn = document.getElementById("graph-zoom-out");
    if (zoomOutBtn) zoomOutBtn.onclick = function() {
      svg.transition().call(zoom.scaleBy, 0.7);
    };
    const zoomResetBtn = document.getElementById("graph-zoom-reset");
    if (zoomResetBtn) zoomResetBtn.onclick = function() {
      svg.transition().call(zoom.transform, d3.zoomIdentity);
    };
    window._graphNode = node;
    window._graphLink = link;
    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    graphRendered = true;
  }
  function updateGraphVisibility() {
    if (!window._graphNode) return;
    window._graphNode.style("display", function(d) {
      return disabledCategories.has(d.category) ? "none" : null;
    });
    window._graphLink.style("display", function(d) {
      const src = typeof d.source === "object" ? d.source : { category: "" };
      const tgt = typeof d.target === "object" ? d.target : { category: "" };
      return disabledCategories.has(src.category) || disabledCategories.has(tgt.category) ? "none" : null;
    });
  }

  // src/server/wiki/spa/client/ask-ai.ts
  var conversationHistory = [];
  var askStreaming = false;
  var askPanelOpen = false;
  var currentSessionId = null;
  function updateAskSubject(name) {
    const el = document.getElementById("ask-bar-subject");
    if (el) el.textContent = name;
  }
  function expandWidget() {
    if (askPanelOpen) return;
    askPanelOpen = true;
    const widget = document.getElementById("ask-widget");
    if (widget) widget.classList.add("expanded");
    const header = document.getElementById("ask-widget-header");
    if (header) header.classList.remove("hidden");
    const messages = document.getElementById("ask-messages");
    if (messages) messages.classList.remove("hidden");
  }
  function collapseWidget() {
    askPanelOpen = false;
    const widget = document.getElementById("ask-widget");
    if (widget) widget.classList.remove("expanded");
    const header = document.getElementById("ask-widget-header");
    if (header) header.classList.add("hidden");
    const messages = document.getElementById("ask-messages");
    if (messages) messages.classList.add("hidden");
  }
  function askPanelSend() {
    if (askStreaming) return;
    const input = document.getElementById("ask-textarea");
    if (!input) return;
    const question = input.value.trim();
    if (!question) return;
    expandWidget();
    input.value = "";
    input.style.height = "auto";
    appendAskMessage("user", question);
    conversationHistory.push({ role: "user", content: question });
    askStreaming = true;
    const sendBtn = document.getElementById("ask-widget-send");
    if (sendBtn) sendBtn.disabled = true;
    let typingEl = appendAskTyping();
    const requestBody = { question };
    if (currentSessionId) {
      requestBody.sessionId = currentSessionId;
    } else {
      requestBody.conversationHistory = conversationHistory.slice(0, -1);
    }
    fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    }).then(function(response) {
      if (!response.ok) {
        return response.json().then(function(err) {
          throw new Error(err.error || "Request failed");
        });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";
      let contextShown = false;
      let responseEl = null;
      function processChunk(result) {
        if (result.done) {
          if (buffer.trim()) {
            const remaining = buffer.trim();
            if (remaining.startsWith("data: ")) {
              try {
                const data = JSON.parse(remaining.slice(6));
                if (data.type === "chunk") {
                  fullResponse += data.content;
                  if (!responseEl) responseEl = appendAskAssistantStreaming("");
                  updateAskAssistantStreaming(responseEl, fullResponse);
                } else if (data.type === "done") {
                  fullResponse = data.fullResponse || fullResponse;
                  if (data.sessionId) currentSessionId = data.sessionId;
                }
              } catch (_e) {
              }
            }
          }
          finishStreaming(fullResponse, typingEl);
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "context" && !contextShown) {
              contextShown = true;
              appendAskContext(data.componentIds, data.themeIds);
            } else if (data.type === "chunk") {
              if (typingEl && typingEl.parentNode) {
                typingEl.parentNode.removeChild(typingEl);
                typingEl = null;
              }
              fullResponse += data.content;
              if (!responseEl) responseEl = appendAskAssistantStreaming("");
              updateAskAssistantStreaming(responseEl, fullResponse);
            } else if (data.type === "done") {
              fullResponse = data.fullResponse || fullResponse;
              if (data.sessionId) currentSessionId = data.sessionId;
              finishStreaming(fullResponse, typingEl);
              return;
            } else if (data.type === "error") {
              appendAskError(data.message);
              finishStreaming("", typingEl);
              return;
            }
          } catch (_e) {
          }
        }
        return reader.read().then(processChunk);
      }
      return reader.read().then(processChunk);
    }).catch(function(err) {
      if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
      appendAskError(err.message || "Failed to connect");
      finishStreaming("", null);
    });
  }
  function finishStreaming(fullResponse, typingEl) {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    askStreaming = false;
    const sendBtn = document.getElementById("ask-widget-send");
    if (sendBtn) sendBtn.disabled = false;
    if (fullResponse) {
      conversationHistory.push({ role: "assistant", content: fullResponse });
    }
  }
  function appendAskMessage(role, content) {
    const messages = document.getElementById("ask-messages");
    const div = document.createElement("div");
    div.className = "ask-message";
    const inner = document.createElement("div");
    inner.className = "ask-message-" + role;
    inner.textContent = content;
    div.appendChild(inner);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }
  function appendAskAssistantStreaming(content) {
    const messages = document.getElementById("ask-messages");
    const div = document.createElement("div");
    div.className = "ask-message";
    const inner = document.createElement("div");
    inner.className = "ask-message-assistant";
    inner.innerHTML = '<div class="markdown-body">' + (typeof marked !== "undefined" ? marked.parse(content) : escapeHtml(content)) + "</div>";
    div.appendChild(inner);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return inner;
  }
  function updateAskAssistantStreaming(el, content) {
    if (!el) return;
    el.innerHTML = '<div class="markdown-body">' + (typeof marked !== "undefined" ? marked.parse(content) : escapeHtml(content)) + "</div>";
    const messages = document.getElementById("ask-messages");
    if (messages) messages.scrollTop = messages.scrollHeight;
  }
  function appendAskContext(componentIds, themeIds) {
    if ((!componentIds || componentIds.length === 0) && (!themeIds || themeIds.length === 0)) return;
    const messages = document.getElementById("ask-messages");
    if (!messages) return;
    const div = document.createElement("div");
    div.className = "ask-message-context";
    let parts = [];
    if (componentIds && componentIds.length > 0) {
      const links = componentIds.map(function(id) {
        const mod = componentGraph.components.find(function(m) {
          return m.id === id;
        });
        const name = mod ? mod.name : id;
        return `<a onclick="loadComponent('` + id.replace(/'/g, "\\'") + `')">\u{1F4E6} ` + escapeHtml(name) + "</a>";
      });
      parts = parts.concat(links);
    }
    if (themeIds && themeIds.length > 0) {
      const themeLinks = themeIds.map(function(ref) {
        const refParts = ref.split("/");
        const themeId = refParts[0] || ref;
        const slug = refParts[1] || themeId;
        return `<a onclick="loadThemeArticle('` + themeId.replace(/'/g, "\\'") + "', '" + slug.replace(/'/g, "\\'") + `')">\u{1F4CB} ` + escapeHtml(ref) + "</a>";
      });
      parts = parts.concat(themeLinks);
    }
    div.innerHTML = "Context: " + parts.join(", ");
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }
  function appendAskTyping() {
    const messages = document.getElementById("ask-messages");
    const div = document.createElement("div");
    div.className = "ask-message";
    const inner = document.createElement("div");
    inner.className = "ask-message-typing";
    inner.textContent = "Thinking";
    div.appendChild(inner);
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
    return div;
  }
  function appendAskError(message) {
    const messages = document.getElementById("ask-messages");
    if (!messages) return;
    const div = document.createElement("div");
    div.className = "ask-message-error";
    div.textContent = "Error: " + message;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }
  var deepDiveStreaming = false;
  function addDeepDiveButton(componentId) {
    const content = document.getElementById("content");
    if (!content) return;
    const markdownBody = content.querySelector(".markdown-body");
    if (!markdownBody) return;
    const btn = document.createElement("button");
    btn.className = "deep-dive-btn";
    btn.innerHTML = "&#128269; Explore Further";
    btn.onclick = function() {
      toggleDeepDiveSection(componentId, btn);
    };
    markdownBody.insertBefore(btn, markdownBody.firstChild);
  }
  function toggleDeepDiveSection(componentId, btn) {
    const existing = document.getElementById("deep-dive-section");
    if (existing) {
      existing.parentNode.removeChild(existing);
      return;
    }
    const section = document.createElement("div");
    section.id = "deep-dive-section";
    section.className = "deep-dive-section";
    section.innerHTML = '<div class="deep-dive-input-area"><input type="text" class="deep-dive-input" id="deep-dive-input" placeholder="Ask a specific question about this component... (optional)"><button class="deep-dive-submit" id="deep-dive-submit">Explore</button></div><div class="deep-dive-result" id="deep-dive-result"></div>';
    btn.insertAdjacentElement("afterend", section);
    const submitBtn = document.getElementById("deep-dive-submit");
    if (submitBtn) submitBtn.onclick = function() {
      startDeepDive(componentId);
    };
    const deepDiveInput = document.getElementById("deep-dive-input");
    if (deepDiveInput) {
      deepDiveInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
          e.preventDefault();
          startDeepDive(componentId);
        }
      });
      deepDiveInput.focus();
    }
  }
  function startDeepDive(componentId) {
    if (deepDiveStreaming) return;
    deepDiveStreaming = true;
    const input = document.getElementById("deep-dive-input");
    const submitBtn = document.getElementById("deep-dive-submit");
    const resultDiv = document.getElementById("deep-dive-result");
    const question = input ? input.value.trim() : "";
    if (submitBtn) submitBtn.disabled = true;
    if (resultDiv) resultDiv.innerHTML = '<div class="deep-dive-status">Analyzing component...</div>';
    const body = {};
    if (question) body.question = question;
    body.depth = "deep";
    fetch("/api/explore/" + encodeURIComponent(componentId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function(response) {
      if (!response.ok) {
        return response.json().then(function(err) {
          throw new Error(err.error || "Request failed");
        });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";
      function processChunk(result) {
        if (result.done) {
          if (buffer.trim()) {
            const remaining = buffer.trim();
            if (remaining.startsWith("data: ")) {
              try {
                const data = JSON.parse(remaining.slice(6));
                if (data.type === "chunk") fullResponse += data.text;
                else if (data.type === "done") fullResponse = data.fullResponse || fullResponse;
              } catch (_e) {
              }
            }
          }
          finishDeepDive(fullResponse, resultDiv, submitBtn);
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "status") {
              if (resultDiv) resultDiv.innerHTML = '<div class="deep-dive-status">' + escapeHtml(data.message) + "</div>";
            } else if (data.type === "chunk") {
              fullResponse += data.text;
              if (resultDiv) {
                resultDiv.innerHTML = '<div class="markdown-body">' + (typeof marked !== "undefined" ? marked.parse(fullResponse) : escapeHtml(fullResponse)) + "</div>";
              }
            } else if (data.type === "done") {
              fullResponse = data.fullResponse || fullResponse;
              finishDeepDive(fullResponse, resultDiv, submitBtn);
              return;
            } else if (data.type === "error") {
              if (resultDiv) resultDiv.innerHTML = '<div class="ask-message-error">Error: ' + escapeHtml(data.message) + "</div>";
              finishDeepDive("", resultDiv, submitBtn);
              return;
            }
          } catch (_e) {
          }
        }
        return reader.read().then(processChunk);
      }
      return reader.read().then(processChunk);
    }).catch(function(err) {
      if (resultDiv) resultDiv.innerHTML = '<div class="ask-message-error">Error: ' + escapeHtml(err.message) + "</div>";
      finishDeepDive("", resultDiv, submitBtn);
    });
  }
  function finishDeepDive(fullResponse, resultDiv, submitBtn) {
    deepDiveStreaming = false;
    if (submitBtn) submitBtn.disabled = false;
    if (fullResponse && resultDiv) {
      resultDiv.innerHTML = '<div class="markdown-body">' + (typeof marked !== "undefined" ? marked.parse(fullResponse) : escapeHtml(fullResponse)) + "</div>";
      resultDiv.querySelectorAll("pre code").forEach(function(block) {
        hljs.highlightElement(block);
      });
    }
  }
  function setupAskAiListeners() {
    const closeBtn = document.getElementById("ask-close");
    if (closeBtn) closeBtn.addEventListener("click", collapseWidget);
    const clearBtn = document.getElementById("ask-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", function() {
        if (currentSessionId) {
          fetch("/api/ask/session/" + encodeURIComponent(currentSessionId), { method: "DELETE" }).catch(function() {
          });
          currentSessionId = null;
        }
        conversationHistory = [];
        const messages = document.getElementById("ask-messages");
        if (messages) messages.innerHTML = "";
      });
    }
    const sendBtn = document.getElementById("ask-widget-send");
    if (sendBtn) sendBtn.addEventListener("click", askPanelSend);
    const textarea = document.getElementById("ask-textarea");
    if (textarea) {
      textarea.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          askPanelSend();
        }
      });
      textarea.addEventListener("input", function() {
        textarea.style.height = "auto";
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
      });
    }
    document.addEventListener("keydown", function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        const collapseBtn = document.getElementById("sidebar-collapse");
        if (collapseBtn) collapseBtn.click();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "i") {
        e.preventDefault();
        if (askPanelOpen) collapseWidget();
        else {
          expandWidget();
          const ta = document.getElementById("ask-textarea");
          if (ta) ta.focus();
        }
      }
      if (e.key === "Escape") {
        if (askPanelOpen) collapseWidget();
      }
    });
  }

  // src/server/wiki/spa/client/websocket.ts
  var wsReconnectTimer = null;
  var wsReconnectDelay = 1e3;
  function connectWebSocket() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = protocol + "//" + location.host + "/ws";
    const ws = new WebSocket(wsUrl);
    ws.onopen = function() {
      wsReconnectDelay = 1e3;
      setInterval(function() {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 3e4);
    };
    ws.onmessage = function(event) {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (_e) {
      }
    };
    ws.onclose = function() {
      wsReconnectTimer = setTimeout(function() {
        wsReconnectDelay = Math.min(wsReconnectDelay * 2, 3e4);
        connectWebSocket();
      }, wsReconnectDelay);
    };
    ws.onerror = function() {
    };
  }
  function handleWsMessage(msg) {
    const bar = document.getElementById("live-reload-bar");
    if (!bar) return;
    if (msg.type === "rebuilding") {
      bar.className = "live-reload-bar visible rebuilding";
      bar.textContent = "Rebuilding: " + (msg.components || []).join(", ") + "...";
    } else if (msg.type === "reload") {
      bar.className = "live-reload-bar visible reloaded";
      bar.textContent = "Updated: " + (msg.components || []).join(", ");
      (msg.components || []).forEach(function(id) {
        delete markdownCache[id];
      });
      if (currentComponentId && (msg.components || []).indexOf(currentComponentId) !== -1) {
        window.loadComponent(currentComponentId, true);
      }
      setTimeout(function() {
        bar.className = "live-reload-bar";
      }, 3e3);
    } else if (msg.type === "error") {
      bar.className = "live-reload-bar visible error";
      bar.textContent = "Error: " + (msg.message || "Unknown error");
      setTimeout(function() {
        bar.className = "live-reload-bar";
      }, 5e3);
    }
  }

  // src/server/wiki/spa/client/admin.ts
  var adminSeedsOriginal = "";
  var adminConfigOriginal = "";
  var adminInitialized = false;
  var generateRunning = false;
  function showAdmin(skipHistory) {
    setCurrentComponentId(null);
    showAdminContent();
    if (!skipHistory) {
      history.pushState({ type: "admin" }, "", location.pathname + "#admin");
    }
    if (!adminInitialized) {
      initAdminEvents();
      initGenerateEvents();
      initPhase4ComponentList();
      adminInitialized = true;
    }
    loadAdminSeeds();
    loadAdminConfig();
    loadGenerateStatus();
  }
  function setupAdminListeners() {
    const adminToggle = document.getElementById("admin-toggle");
    if (adminToggle) {
      adminToggle.addEventListener("click", function() {
        showAdmin(false);
      });
    }
  }
  function initAdminEvents() {
    document.querySelectorAll(".admin-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        const target = tab.getAttribute("data-tab");
        document.querySelectorAll(".admin-tab").forEach(function(t) {
          t.classList.remove("active");
        });
        document.querySelectorAll(".admin-tab-content").forEach(function(c) {
          c.classList.remove("active");
        });
        tab.classList.add("active");
        const contentEl = document.getElementById("admin-content-" + target);
        if (contentEl) contentEl.classList.add("active");
      });
    });
    const seedsSave = document.getElementById("seeds-save");
    if (seedsSave) {
      seedsSave.addEventListener("click", async function() {
        clearAdminStatus("seeds");
        const editor = document.getElementById("seeds-editor");
        if (!editor) return;
        const text = editor.value;
        let content;
        try {
          content = JSON.parse(text);
        } catch (e) {
          setAdminStatus("seeds", "Invalid JSON: " + e.message, true);
          return;
        }
        try {
          const res = await fetch("/api/admin/seeds", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content })
          });
          const data = await res.json();
          if (data.success) {
            setAdminStatus("seeds", "Saved", false);
            adminSeedsOriginal = text;
          } else {
            setAdminStatus("seeds", data.error || "Save failed", true);
          }
        } catch (err) {
          setAdminStatus("seeds", "Error: " + err.message, true);
        }
      });
    }
    const seedsReset = document.getElementById("seeds-reset");
    if (seedsReset) {
      seedsReset.addEventListener("click", function() {
        const editor = document.getElementById("seeds-editor");
        if (editor) editor.value = adminSeedsOriginal;
        clearAdminStatus("seeds");
      });
    }
    const configSave = document.getElementById("config-save");
    if (configSave) {
      configSave.addEventListener("click", async function() {
        clearAdminStatus("config");
        const editor = document.getElementById("config-editor");
        if (!editor) return;
        const text = editor.value;
        try {
          const res = await fetch("/api/admin/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: text })
          });
          const data = await res.json();
          if (data.success) {
            setAdminStatus("config", "Saved", false);
            adminConfigOriginal = text;
          } else {
            setAdminStatus("config", data.error || "Save failed", true);
          }
        } catch (err) {
          setAdminStatus("config", "Error: " + err.message, true);
        }
      });
    }
    const configReset = document.getElementById("config-reset");
    if (configReset) {
      configReset.addEventListener("click", function() {
        const editor = document.getElementById("config-editor");
        if (editor) editor.value = adminConfigOriginal;
        clearAdminStatus("config");
      });
    }
  }
  function setAdminStatus(which, msg, isError) {
    const el = document.getElementById(which + "-status");
    if (!el) return;
    el.textContent = msg;
    el.className = "admin-file-status " + (isError ? "error" : "success");
  }
  function clearAdminStatus(which) {
    const el = document.getElementById(which + "-status");
    if (!el) return;
    el.textContent = "";
    el.className = "admin-file-status";
  }
  async function loadAdminSeeds() {
    try {
      const res = await fetch("/api/admin/seeds");
      const data = await res.json();
      const pathEl = document.getElementById("seeds-path");
      if (pathEl) pathEl.textContent = data.path || "seeds.json";
      const editor = document.getElementById("seeds-editor");
      if (!editor) return;
      if (data.exists && data.content) {
        const text = JSON.stringify(data.content, null, 2);
        editor.value = text;
        adminSeedsOriginal = text;
      } else if (data.exists && data.raw) {
        editor.value = data.raw;
        adminSeedsOriginal = data.raw;
      } else {
        editor.value = "";
        adminSeedsOriginal = "";
      }
    } catch (err) {
      setAdminStatus("seeds", "Failed to load: " + err.message, true);
    }
  }
  async function loadAdminConfig() {
    try {
      const res = await fetch("/api/admin/config");
      const data = await res.json();
      const pathEl = document.getElementById("config-path");
      if (pathEl) pathEl.textContent = data.path || "deep-wiki.config.yaml";
      const editor = document.getElementById("config-editor");
      if (!editor) return;
      if (data.exists && data.content) {
        editor.value = data.content;
        adminConfigOriginal = data.content;
      } else {
        editor.value = "";
        adminConfigOriginal = "";
      }
    } catch (err) {
      setAdminStatus("config", "Failed to load: " + err.message, true);
    }
  }
  function initGenerateEvents() {
    for (let i = 1; i <= 5; i++) {
      (function(phase) {
        const btn = document.getElementById("phase-run-" + phase);
        if (btn) {
          btn.addEventListener("click", function() {
            runPhaseGeneration(phase, phase);
          });
        }
      })(i);
    }
    const rangeBtn = document.getElementById("generate-run-range");
    if (rangeBtn) {
      rangeBtn.addEventListener("click", function() {
        const startEl = document.getElementById("generate-start-phase");
        const endEl = document.getElementById("generate-end-phase");
        if (!startEl || !endEl) return;
        const startPhase = parseInt(startEl.value);
        const endPhase = parseInt(endEl.value);
        if (endPhase < startPhase) {
          alert("End phase must be >= start phase");
          return;
        }
        runPhaseGeneration(startPhase, endPhase);
      });
    }
  }
  async function loadGenerateStatus() {
    try {
      const res = await fetch("/api/admin/generate/status");
      const data = await res.json();
      const wizardEl = document.getElementById("bootstrap-wizard");
      const controlsEl = document.getElementById("generate-controls");
      if (!data.available) {
        if (wizardEl) wizardEl.classList.remove("hidden");
        if (controlsEl) controlsEl.style.display = "none";
        return;
      }
      if (wizardEl) wizardEl.classList.add("hidden");
      if (controlsEl) controlsEl.style.display = "";
      for (let phase = 1; phase <= 5; phase++) {
        const badge = document.getElementById("phase-cache-" + phase);
        if (!badge) continue;
        const phaseData = data.phases[String(phase)];
        if (phaseData && phaseData.cached) {
          badge.textContent = "Cached";
          badge.className = "phase-cache-badge cached";
        } else {
          badge.textContent = "None";
          badge.className = "phase-cache-badge missing";
        }
      }
      if (data.running) {
        generateRunning = true;
        setAllPhaseButtonsDisabled(true);
        const statusBar = document.getElementById("generate-status-bar");
        if (statusBar) {
          statusBar.textContent = "Phase " + (data.currentPhase || "?") + " is running...";
          statusBar.classList.remove("hidden");
        }
      } else {
        generateRunning = false;
      }
      const phase4Data = data.phases["4"];
      if (phase4Data && phase4Data.components) {
        renderPhase4ComponentList(phase4Data.components);
      }
    } catch (_err) {
    }
  }
  function setAllPhaseButtonsDisabled(disabled) {
    for (let i = 1; i <= 5; i++) {
      const btn = document.getElementById("phase-run-" + i);
      if (btn) btn.disabled = disabled;
    }
    const rangeBtn = document.getElementById("generate-run-range");
    if (rangeBtn) rangeBtn.disabled = disabled;
  }
  function setPhaseCardState(phase, state, message) {
    const card = document.getElementById("phase-card-" + phase);
    if (!card) return;
    card.classList.remove("phase-running", "phase-success", "phase-error");
    const btn = document.getElementById("phase-run-" + phase);
    const logEl = document.getElementById("phase-log-" + phase);
    switch (state) {
      case "running":
        card.classList.add("phase-running");
        if (btn) {
          btn.textContent = "Cancel";
          btn.disabled = false;
          btn.onclick = function() {
            cancelGeneration();
          };
        }
        if (logEl) {
          logEl.classList.remove("hidden");
          logEl.textContent = message || "Running...";
        }
        break;
      case "success":
        card.classList.add("phase-success");
        if (btn) {
          btn.textContent = "Run";
          btn.disabled = false;
          btn.onclick = null;
          btn.addEventListener("click", /* @__PURE__ */ function(p) {
            return function() {
              runPhaseGeneration(p, p);
            };
          }(phase));
        }
        if (logEl && message) {
          logEl.textContent = message;
        }
        break;
      case "error":
        card.classList.add("phase-error");
        if (btn) {
          btn.textContent = "Run";
          btn.disabled = false;
          btn.onclick = null;
          btn.addEventListener("click", /* @__PURE__ */ function(p) {
            return function() {
              runPhaseGeneration(p, p);
            };
          }(phase));
        }
        if (logEl && message) {
          logEl.classList.remove("hidden");
          logEl.textContent = message;
        }
        break;
      case "idle":
        if (btn) {
          btn.textContent = "Run";
          btn.disabled = false;
          btn.onclick = null;
          btn.addEventListener("click", /* @__PURE__ */ function(p) {
            return function() {
              runPhaseGeneration(p, p);
            };
          }(phase));
        }
        break;
    }
  }
  function appendPhaseLog(phase, message) {
    const logEl = document.getElementById("phase-log-" + phase);
    if (!logEl) return;
    logEl.classList.remove("hidden");
    logEl.textContent += "\n" + message;
    logEl.scrollTop = logEl.scrollHeight;
  }
  async function runPhaseGeneration(startPhase, endPhase) {
    if (generateRunning) return;
    generateRunning = true;
    const forceEl = document.getElementById("generate-force");
    const force = forceEl ? forceEl.checked : false;
    setAllPhaseButtonsDisabled(true);
    for (let i = startPhase; i <= endPhase; i++) {
      const logEl = document.getElementById("phase-log-" + i);
      if (logEl) {
        logEl.textContent = "";
        logEl.classList.add("hidden");
      }
      setPhaseCardState(i, "idle", "");
    }
    const statusBar = document.getElementById("generate-status-bar");
    if (statusBar) {
      statusBar.textContent = "Starting generation (phases " + startPhase + "-" + endPhase + ")...";
      statusBar.className = "generate-status-bar";
      statusBar.classList.remove("hidden");
    }
    try {
      const response = await fetch("/api/admin/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startPhase, endPhase, force })
      });
      if (response.status === 409) {
        if (statusBar) {
          statusBar.textContent = "Generation already in progress";
          statusBar.className = "generate-status-bar error";
        }
        generateRunning = false;
        setAllPhaseButtonsDisabled(false);
        return;
      }
      if (!response.ok) {
        const errData = await response.json();
        if (statusBar) {
          statusBar.textContent = "Error: " + (errData.error || "Unknown error");
          statusBar.className = "generate-status-bar error";
        }
        generateRunning = false;
        setAllPhaseButtonsDisabled(false);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.substring(6));
            handleGenerateEvent(event, statusBar);
          } catch (_e) {
          }
        }
      }
    } catch (err) {
      if (statusBar) {
        statusBar.textContent = "Connection error: " + err.message;
        statusBar.className = "generate-status-bar error";
      }
    } finally {
      generateRunning = false;
      setAllPhaseButtonsDisabled(false);
      loadGenerateStatus();
    }
  }
  function handleGenerateEvent(event, statusBar) {
    switch (event.type) {
      case "status":
        setPhaseCardState(event.phase, "running", event.message);
        if (statusBar) statusBar.textContent = "Phase " + event.phase + ": " + event.message;
        break;
      case "log":
        if (event.phase) {
          appendPhaseLog(event.phase, event.message);
        }
        break;
      case "progress":
        if (event.phase) {
          appendPhaseLog(event.phase, "Progress: " + event.current + "/" + event.total);
        }
        break;
      case "phase-complete":
        if (event.success) {
          const dur = event.duration ? " (" + formatDuration(event.duration) + ")" : "";
          setPhaseCardState(event.phase, "success", event.message + dur);
          appendPhaseLog(event.phase, "Completed" + dur + ": " + event.message);
        } else {
          setPhaseCardState(event.phase, "error", event.message);
        }
        break;
      case "error":
        if (event.phase) {
          setPhaseCardState(event.phase, "error", event.message);
          appendPhaseLog(event.phase, "Error: " + event.message);
        }
        if (statusBar) {
          statusBar.textContent = "Error: " + event.message;
          statusBar.className = "generate-status-bar error";
        }
        break;
      case "done":
        if (event.success) {
          const totalDur = event.duration ? " in " + formatDuration(event.duration) : "";
          if (statusBar) {
            statusBar.textContent = "Generation completed" + totalDur;
            statusBar.className = "generate-status-bar success";
          }
        } else {
          if (statusBar) {
            statusBar.textContent = "Generation failed: " + (event.error || "Unknown error");
            statusBar.className = "generate-status-bar error";
          }
        }
        break;
    }
  }
  function formatDuration(ms) {
    if (ms < 1e3) return ms + "ms";
    const seconds = Math.round(ms / 1e3);
    if (seconds < 60) return seconds + "s";
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return minutes + "m " + remainingSeconds + "s";
  }
  async function cancelGeneration() {
    try {
      await fetch("/api/admin/generate/cancel", { method: "POST" });
    } catch (_e) {
    }
  }
  function initPhase4ComponentList() {
    const toggle = document.getElementById("phase4-component-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", function() {
      const list = document.getElementById("phase4-component-list");
      const expanded = toggle.classList.toggle("expanded");
      if (list) {
        list.classList.toggle("expanded", expanded);
      }
    });
  }
  function renderPhase4ComponentList(components) {
    const toggle = document.getElementById("phase4-component-toggle");
    const list = document.getElementById("phase4-component-list");
    const countEl = document.getElementById("phase4-component-count");
    if (!toggle || !list || !components) return;
    const keys = Object.keys(components);
    if (keys.length === 0) {
      toggle.style.display = "none";
      return;
    }
    toggle.style.display = "";
    if (countEl) countEl.textContent = String(keys.length);
    let html = "";
    keys.forEach(function(componentId) {
      const info = components[componentId];
      const mod = componentGraph ? componentGraph.components.find(function(m) {
        return m.id === componentId;
      }) : null;
      const name = mod ? mod.name : componentId;
      const badgeClass = info.cached ? "cached" : "missing";
      const badgeText = info.cached ? "\u2713" : "\u2717";
      html += '<div class="phase-component-row" id="phase4-comp-row-' + componentId.replace(/[^a-z0-9-]/g, "_") + '"><span class="phase-component-badge ' + badgeClass + '">' + badgeText + '</span><span class="phase-component-id">' + escapeHtml(componentId) + '</span><span class="phase-component-name">' + escapeHtml(name) + `</span><button class="phase-component-run-btn" onclick="runComponentRegenFromAdmin('` + componentId.replace(/'/g, "\\'") + `')" title="Regenerate article for ` + escapeHtml(name) + '">Run</button></div><div class="phase-component-log" id="phase4-comp-log-' + componentId.replace(/[^a-z0-9-]/g, "_") + '"></div>';
    });
    list.innerHTML = html;
  }
  async function runComponentRegenFromAdmin(componentId) {
    if (generateRunning) return;
    generateRunning = true;
    const safeId = componentId.replace(/[^a-z0-9-]/g, "_");
    const row = document.getElementById("phase4-comp-row-" + safeId);
    const logEl = document.getElementById("phase4-comp-log-" + safeId);
    const btn = row ? row.querySelector(".phase-component-run-btn") : null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "...";
    }
    if (logEl) {
      logEl.textContent = "Regenerating...";
      logEl.classList.add("visible");
    }
    setAllPhaseButtonsDisabled(true);
    const forceEl = document.getElementById("generate-force");
    try {
      const response = await fetch("/api/admin/generate/component/" + encodeURIComponent(componentId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: forceEl ? forceEl.checked : false })
      });
      if (response.status === 409) {
        if (logEl) logEl.textContent = "Error: Generation already in progress";
        return;
      }
      if (!response.ok && response.headers.get("content-type")?.indexOf("text/event-stream") === -1) {
        const errData = await response.json();
        if (logEl) logEl.textContent = "Error: " + (errData.error || "Unknown error");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.substring(6));
            if (logEl) {
              if (event.type === "log" || event.type === "status") {
                logEl.textContent += "\n" + event.message;
                logEl.scrollTop = logEl.scrollHeight;
              }
              if (event.type === "done") {
                const dur = event.duration ? " (" + formatDuration(event.duration) + ")" : "";
                logEl.textContent += "\n" + (event.success ? "Done" + dur : "Failed: " + (event.error || "Unknown"));
              }
              if (event.type === "error") {
                logEl.textContent += "\nError: " + event.message;
              }
            }
          } catch (_e) {
          }
        }
      }
    } catch (err) {
      if (logEl) logEl.textContent += "\nConnection error: " + err.message;
    } finally {
      generateRunning = false;
      setAllPhaseButtonsDisabled(false);
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Run";
      }
      loadGenerateStatus();
    }
  }

  // src/server/wiki/spa/client/index.ts
  var config3 = window.__WIKI_CONFIG__;
  window.loadComponent = loadComponent;
  window.showHome = showHome;
  window.showGraph = showGraph;
  window.showAdmin = showAdmin;
  window.loadSpecialPage = loadSpecialPage;
  window.loadThemeArticle = loadThemeArticle;
  window.toggleSourceFiles = toggleSourceFiles;
  window.escapeHtml = escapeHtml;
  window.regenerateComponent = regenerateComponent;
  window.runComponentRegenFromAdmin = runComponentRegenFromAdmin;
  window.initTheme = initTheme;
  window.initializeSidebar = initializeSidebar;
  window.renderMarkdownContent = renderMarkdownContent;
  window.processMarkdownContent = processMarkdownContent;
  window.buildToc = buildToc;
  window.updateAskSubject = updateAskSubject;
  window.addDeepDiveButton = addDeepDiveButton;
  setupPopstateHandler();
  setupThemeListeners();
  setupAskAiListeners();
  setupAdminListeners();
  init();
  if (config3.enableWatch) {
    connectWebSocket();
  }
})();
