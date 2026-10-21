// PR dashboard: an extension canvas that reads pull requests through
// host.runScript + query_pull_request. Inputs reach the script through
// `state`, never by building the code string from values.
capabilities = {
  set_repo(state, params) {
    return { ...state, provider: params.provider, repository: params.repository, prs: [], errors: [] };
  },
  async refresh(state, params, host) {
    const out = await host.runScript(`
      const list = await tools.query_pull_request({
        provider: state.provider, repository: state.repository, status: 'open', limit: 10 });
      if (!list.success) return { error: list.code + ': ' + list.error };
      const ids = list.items.slice(0, 5).map(p => p.id);
      if (ids.length === 0) return { items: [], details: [] };
      const got = await tools.query_pull_request({
        provider: state.provider, repository: state.repository, ids });
      return { items: list.items, details: got.success ? got.results : [] };
    `, { state: { provider: state.provider, repository: state.repository } });
    const r = out.result;
    if (r.error) return { ...state, errors: [r.error] };
    const detailById = new Map(r.details.filter(d => d.ok).map(d => [d.id, d.pullRequest]));
    return {
      ...state,
      errors: [],
      refreshedAt: new Date().toISOString(),
      prs: r.items.map(p => ({
        id: p.id, title: p.title, url: p.url, author: p.author, isDraft: p.isDraft,
        ci: p.ci, hasDetail: detailById.has(p.id),
      })),
    };
  },
};
