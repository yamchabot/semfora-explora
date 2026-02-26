/**
 * ImportRepoModal — paste a GitHub URL, track import progress, then navigate
 * to Explore for the new repo.
 *
 * Usage:
 *   <ImportRepoModal onClose={() => …} onImported={(repoId) => …} />
 */
import { useState, useEffect, useRef } from "react";

const STEPS = ["cloning", "indexing", "exporting", "enriching", "done"];
const STEP_LABELS = {
  queued:    "Queued…",
  cloning:   "Cloning repository",
  indexing:  "Building semantic index",
  exporting: "Exporting to SQLite",
  enriching: "Running enrichment",
  done:      "Complete",
  error:     "Error",
};

const POLL_MS = 1500;

// ── Inline styles ─────────────────────────────────────────────────────────────
const S = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000,
  },
  modal: {
    background: "var(--bg2)", border: "1px solid var(--border2)",
    borderRadius: 10, padding: "28px 32px", width: 480, maxWidth: "95vw",
    boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
  },
  title: { margin: "0 0 18px", fontSize: 16, fontWeight: 600, color: "var(--text1)" },
  label: { display: "block", fontSize: 12, color: "var(--text3)", marginBottom: 6 },
  input: {
    width: "100%", boxSizing: "border-box",
    background: "var(--bg3)", border: "1px solid var(--border2)",
    borderRadius: 6, padding: "8px 12px", fontSize: 13,
    color: "var(--text1)", outline: "none",
  },
  hint: { fontSize: 11, color: "var(--text3)", marginTop: 5 },
  progressWrap: { marginTop: 18 },
  progressBar: {
    height: 6, borderRadius: 3, background: "var(--bg3)",
    overflow: "hidden", marginTop: 6, marginBottom: 4,
  },
  progressFill: (pct, isErr) => ({
    height: "100%", borderRadius: 3, transition: "width 0.4s ease",
    width: `${pct}%`,
    background: isErr ? "var(--red)" : "var(--blue)",
  }),
  stepRow: {
    display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap",
  },
  stepChip: (active, done, err) => ({
    fontSize: 10, padding: "2px 7px", borderRadius: 10,
    background: err ? "var(--red)" : done ? "var(--green)" : active ? "var(--blue)" : "var(--bg3)",
    color: (done || active || err) ? "#fff" : "var(--text3)",
    transition: "background 0.3s",
  }),
  errorBox: {
    marginTop: 14, background: "rgba(255,80,80,0.08)", border: "1px solid var(--red)",
    borderRadius: 6, padding: "10px 12px", fontSize: 12, color: "var(--red)",
    maxHeight: 120, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
  },
  actions: { marginTop: 22, display: "flex", gap: 10, justifyContent: "flex-end" },
  btnPrimary: {
    padding: "7px 18px", borderRadius: 6, border: "none", cursor: "pointer",
    background: "var(--blue)", color: "#fff", fontSize: 13, fontWeight: 500,
  },
  btnSecondary: {
    padding: "7px 14px", borderRadius: 6, cursor: "pointer",
    background: "var(--bg3)", border: "1px solid var(--border2)",
    color: "var(--text2)", fontSize: 13,
  },
  successNote: {
    marginTop: 14, fontSize: 12, color: "var(--green)",
    display: "flex", alignItems: "center", gap: 6,
  },
};

export default function ImportRepoModal({ onClose, onImported }) {
  const [url,     setUrl]     = useState("");
  const [jobId,   setJobId]   = useState(null);
  const [job,     setJob]     = useState(null);   // latest status object
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const pollRef = useRef(null);

  // ── Polling ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/import/${jobId}`);
        const data = await res.json();
        setJob(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(pollRef.current);
        }
      } catch {
        // ignore transient network errors
      }
    }, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  const handleClose = () => {
    clearInterval(pollRef.current);
    onClose();
  };

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setError("");
    setLoading(true);
    try {
      const res  = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setJobId(data.job_id);
      setJob(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleOpenExplore = () => {
    if (job?.repo_id) {
      onImported(job.repo_id);
      handleClose();
    }
  };

  // ── Derived display state ──────────────────────────────────────────────────
  const isRunning = job && !["done", "error"].includes(job.status);
  const isDone    = job?.status === "done";
  const isErr     = job?.status === "error";
  const pct       = job?.progress ?? 0;
  const stepIdx   = STEPS.indexOf(job?.status ?? "");

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && handleClose()}>
      <div style={S.modal}>
        <h3 style={S.title}>📥 Import from GitHub</h3>

        {/* URL Input */}
        <label style={S.label}>GitHub repository URL</label>
        <input
          style={S.input}
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !jobId && handleSubmit()}
          placeholder="https://github.com/owner/repo"
          disabled={!!jobId}
          autoFocus
        />
        <div style={S.hint}>
          Supports: /tree/branch, /tree/tag, /commit/sha
        </div>

        {/* Client-side validation error */}
        {error && <div style={S.errorBox}>{error}</div>}

        {/* Progress */}
        {job && (
          <div style={S.progressWrap}>
            <div style={{ fontSize: 12, color: isErr ? "var(--red)" : "var(--text2)" }}>
              {isErr ? "❌ " : isDone ? "✅ " : "⏳ "}
              {job.message || STEP_LABELS[job.status] || job.status}
            </div>
            <div style={S.progressBar}>
              <div style={S.progressFill(pct, isErr)} />
            </div>
            <div style={{ fontSize: 10, color: "var(--text3)" }}>{pct}%</div>

            {/* Step chips */}
            <div style={S.stepRow}>
              {STEPS.map((s, i) => (
                <span
                  key={s}
                  style={S.stepChip(
                    s === job.status,
                    !isErr && i < stepIdx,
                    isErr && s === job.status,
                  )}
                >
                  {STEP_LABELS[s]}
                </span>
              ))}
            </div>

            {/* Enrich warning (non-fatal) */}
            {isDone && job.enrich_warning && (
              <div style={{ ...S.errorBox, borderColor: "var(--yellow)", color: "var(--yellow)" }}>
                ⚠ Enrichment warning (base DB still usable):{"\n"}{job.enrich_warning}
              </div>
            )}

            {/* Error detail */}
            {isErr && (
              <div style={S.errorBox}>{job.message}</div>
            )}

            {/* Success note */}
            {isDone && (
              <div style={S.successNote}>
                <span>🎉</span>
                <span>
                  <strong>{job.repo_id}</strong> is ready to explore
                </span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={S.actions}>
          <button style={S.btnSecondary} onClick={handleClose}>
            {isDone ? "Close" : "Cancel"}
          </button>
          {!jobId && (
            <button
              style={{ ...S.btnPrimary, opacity: loading ? 0.6 : 1 }}
              onClick={handleSubmit}
              disabled={loading || !url.trim()}
            >
              {loading ? "Starting…" : "Import"}
            </button>
          )}
          {isDone && (
            <button style={S.btnPrimary} onClick={handleOpenExplore}>
              Open in Explore →
            </button>
          )}
          {isErr && (
            <button style={S.btnSecondary} onClick={() => { setJobId(null); setJob(null); }}>
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
