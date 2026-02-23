import { useState, useRef } from "react";

/**
 * Lightweight tooltip wrapper.
 *
 *   <Tooltip tip="Helpful description">
 *     <button>⬤</button>
 *   </Tooltip>
 *
 * Props:
 *   tip   — tooltip text (string or JSX); pass null/undefined to disable
 *   pos   — "below" (default) | "above"
 *   delay — ms before tooltip appears (default 300)
 */
export function Tooltip({ tip, pos = "below", delay = 300, children }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef(null);

  function show() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(true), delay);
  }
  function hide() {
    clearTimeout(timer.current);
    setVisible(false);
  }

  const offset = pos === "above"
    ? { bottom: "calc(100% + 7px)", top: "auto" }
    : { top:    "calc(100% + 7px)", bottom: "auto" };

  return (
    <div
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && tip != null && (
        <div
          role="tooltip"
          style={{
            position:       "absolute",
            ...offset,
            left:           "50%",
            transform:      "translateX(-50%)",
            background:     "var(--bg0, #0d1117)",
            border:         "1px solid var(--border2, #30363d)",
            borderRadius:   5,
            padding:        "5px 10px",
            fontSize:       11,
            lineHeight:     1.4,
            color:          "var(--text, #e6edf3)",
            whiteSpace:     "nowrap",
            pointerEvents:  "none",
            zIndex:         300,
            boxShadow:      "0 4px 12px rgba(0,0,0,0.55)",
          }}
        >
          {tip}
        </div>
      )}
    </div>
  );
}
