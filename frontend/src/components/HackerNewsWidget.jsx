import { useQuery } from "@tanstack/react-query";

const HN_BASE = "https://hacker-news.firebaseio.com/v0";
const TOP_N = 15;

function timeAgo(unixTs) {
  const secs = Math.floor(Date.now() / 1000) - unixTs;
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function domain(url) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function fetchTopStories() {
  const ids = await fetch(`${HN_BASE}/topstories.json`).then((r) => r.json());
  const top = ids.slice(0, TOP_N);
  const items = await Promise.all(
    top.map((id) => fetch(`${HN_BASE}/item/${id}.json`).then((r) => r.json()))
  );
  return items.filter(Boolean);
}

export default function HackerNewsWidget() {
  const { data: stories, isLoading, error, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ["hn-top"],
    queryFn: fetchTopStories,
    refetchInterval: 5 * 60 * 1000, // every 5 minutes
    staleTime: 4 * 60 * 1000,
  });

  const lastFetched = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 18px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg2)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>🟠</span>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Hacker News</span>
          <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400 }}>Top {TOP_N}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastFetched && (
            <span style={{ fontSize: 11, color: "var(--text3)" }}>
              updated {lastFetched}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh now"
            style={{
              background: "none", border: "1px solid var(--border)", borderRadius: 6,
              color: "var(--text2)", fontSize: 12, padding: "3px 8px", cursor: "pointer",
              opacity: isFetching ? 0.5 : 1,
            }}
          >
            {isFetching ? "…" : "↻"}
          </button>
        </div>
      </div>

      {/* Body */}
      {isLoading && (
        <div style={{ padding: "24px 18px", color: "var(--text3)", fontSize: 13 }}>
          Loading headlines…
        </div>
      )}
      {error && (
        <div style={{ padding: "24px 18px", color: "var(--red)", fontSize: 13 }}>
          Failed to fetch: {error.message}
        </div>
      )}
      {stories && (
        <ol style={{ margin: 0, padding: "8px 0", listStyle: "none" }}>
          {stories.map((story, i) => (
            <li
              key={story.id}
              style={{
                display: "flex", gap: 12, alignItems: "flex-start",
                padding: "10px 18px",
                borderBottom: i < stories.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              {/* Rank */}
              <span style={{
                flexShrink: 0, width: 22, textAlign: "right",
                fontSize: 12, color: "var(--text3)", paddingTop: 1, fontVariantNumeric: "tabular-nums",
              }}>
                {i + 1}
              </span>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ marginBottom: 4 }}>
                  <a
                    href={story.url || `https://news.ycombinator.com/item?id=${story.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: "var(--text)", textDecoration: "none",
                      fontWeight: 500, fontSize: 13, lineHeight: 1.4,
                    }}
                    onMouseEnter={(e) => (e.target.style.color = "var(--blue)")}
                    onMouseLeave={(e) => (e.target.style.color = "var(--text)")}
                  >
                    {story.title}
                  </a>
                  {domain(story.url) && (
                    <span style={{
                      marginLeft: 6, fontSize: 10, color: "var(--text3)",
                      background: "var(--bg3)", padding: "1px 6px", borderRadius: 4,
                      verticalAlign: "middle",
                    }}>
                      {domain(story.url)}
                    </span>
                  )}
                </div>

                {/* Meta row */}
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text3)", flexWrap: "wrap" }}>
                  <span title="Points" style={{ color: "var(--yellow)", fontWeight: 600 }}>
                    ▲ {story.score}
                  </span>
                  <a
                    href={`https://news.ycombinator.com/item?id=${story.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--text3)", textDecoration: "none" }}
                    onMouseEnter={(e) => (e.target.style.color = "var(--blue)")}
                    onMouseLeave={(e) => (e.target.style.color = "var(--text3)")}
                  >
                    💬 {story.descendants ?? 0} comments
                  </a>
                  <span>by {story.by}</span>
                  <span>{timeAgo(story.time)}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Footer */}
      <div style={{
        padding: "8px 18px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg2)",
        fontSize: 11, color: "var(--text3)",
        display: "flex", justifyContent: "space-between",
      }}>
        <span>Auto-refreshes every 5 minutes</span>
        <a
          href="https://news.ycombinator.com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--text3)", textDecoration: "none" }}
          onMouseEnter={(e) => (e.target.style.color = "var(--blue)")}
          onMouseLeave={(e) => (e.target.style.color = "var(--text3)")}
        >
          news.ycombinator.com ↗
        </a>
      </div>
    </div>
  );
}
