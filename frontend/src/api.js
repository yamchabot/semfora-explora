const BASE = "/api";

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export const api = {
  repos: () => get("/repos"),
  overview: (id) => get(`/repos/${id}/overview`),
  modules: (id) => get(`/repos/${id}/modules`),
  moduleEdges: (id) => get(`/repos/${id}/module-edges`),
  graph: (id, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return get(`/repos/${id}/graph${qs ? "?" + qs : ""}`);
  },
  node: (id, hash) => get(`/repos/${id}/nodes/${hash}`),
  blastRadius: (id, hash, depth = 4) =>
    get(`/repos/${id}/blast-radius/${hash}?max_depth=${depth}`),
  deadCode: (id) => get(`/repos/${id}/dead-code`),
  centrality: (id, n = 30) => get(`/repos/${id}/centrality?top_n=${n}`),
  cycles: (id) => get(`/repos/${id}/cycles`),
  search: (id, q) => get(`/repos/${id}/search?q=${encodeURIComponent(q)}`),
  loadBearing: (id, threshold = 3) =>
    get(`/repos/${id}/load-bearing?threshold=${threshold}`),
  lbConfig: (id) => get(`/repos/${id}/load-bearing/config`),
  lbDeclare: (id, hash, module, remove = false) =>
    post(`/repos/${id}/load-bearing/declare`, { hash, module, remove }),
  building: (id) => get(`/repos/${id}/building`),
  moduleGraph: (id, depth = 2) => get(`/repos/${id}/module-graph?depth=${depth}`),
  communities: (id, resolution = 1.0) => get(`/repos/${id}/communities?resolution=${resolution}`),
  triage: (id) => get(`/repos/${id}/triage`),
  moduleEdgesDetail: (id, fromModule, toModule) =>
    get(`/repos/${id}/module-edges-detail?from_module=${encodeURIComponent(fromModule)}&to_module=${encodeURIComponent(toModule)}`),
  exploreKinds: (id) => get(`/repos/${id}/explore/kinds`),
  exploreDimValues: (id, kinds = "") => get(`/repos/${id}/explore/dim-values?kinds=${kinds}`),
  explorePivot: (id, dimensions = ["module"], measures = "symbol_count,dead_ratio,caller_count:avg", kinds = "", compareTo = "") =>
    get(`/repos/${id}/explore?dimensions=${Array.isArray(dimensions)?dimensions.join(","):dimensions}&measures=${measures}&kinds=${kinds}&compare_to=${encodeURIComponent(compareTo)}`),
  exploreNodes: (id, sortBy = "caller_count", sortDir = "desc", limit = 200, kinds = "") =>
    get(`/repos/${id}/explore/nodes?sort_by=${sortBy}&sort_dir=${sortDir}&limit=${limit}&kinds=${kinds}`),
  diff: (repoA, repoB) => post("/diff", { repo_a: repoA, repo_b: repoB }),
  diffGraph: (repoA, repoB, maxContext = 4) =>
    post(`/diff-graph?max_context=${maxContext}`, { repo_a: repoA, repo_b: repoB }),
  diffBuilding: (repoA, repoB) =>
    post("/diff-building", { repo_a: repoA, repo_b: repoB }),
  // Lightweight: just {status_map: {"module::name": "added"|"removed"|"modified"}}
  diffStatus: (repoId, compareTo) =>
    get(`/repos/${encodeURIComponent(repoId)}/diff-status?compare_to=${encodeURIComponent(compareTo)}`),
};
