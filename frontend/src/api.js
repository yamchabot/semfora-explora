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
  diff: (repoA, repoB) => post("/diff", { repo_a: repoA, repo_b: repoB }),
};
