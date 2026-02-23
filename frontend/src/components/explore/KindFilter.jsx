import { useRef } from "react";
import { KIND_PALETTE } from "../../utils/exploreConstants.js";

/**
 * Horizontal row of kind toggle buttons.
 * kinds=[] means ALL selected (no filter). Active = included.
 */
export function KindFilter({ availableKinds, kinds, onChange }) {
  const allActive = kinds.length === 0;
  const colorMap  = useRef(new Map());

  function kindColor(k) {
    if (!colorMap.current.has(k))
      colorMap.current.set(k, KIND_PALETTE[colorMap.current.size % KIND_PALETTE.length]);
    return colorMap.current.get(k);
  }

  function toggle(k) {
    if (allActive) {
      onChange(availableKinds.filter(x => x !== k));
    } else if (kinds.includes(k)) {
      const next = kinds.filter(x => x !== k);
      onChange(next.length === 0 ? [] : next);
    } else {
      const next = [...kinds, k];
      onChange(next.length >= availableKinds.length ? [] : next);
    }
  }

  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
      <span style={{ fontSize:11, fontWeight:600, color:"var(--text3)", textTransform:"uppercase", letterSpacing:"0.08em", width:80 }}>Kind filter</span>
      <button
        className={`btn btn-sm ${allActive ? "" : "btn-ghost"}`}
        style={{ fontSize:11 }}
        onClick={() => onChange([])}
      >all</button>
      {availableKinds.map(k => {
        const active = allActive || kinds.includes(k);
        const color  = kindColor(k);
        return (
          <button key={k} onClick={() => toggle(k)} style={{
            padding:"3px 10px", fontSize:11, borderRadius:6, cursor:"pointer", border:"none",
            background: active ? color + "22" : "var(--bg3)",
            color:      active ? color : "var(--text3)",
            outline:    active ? `1px solid ${color}` : "1px solid var(--border)",
            transition: "all 0.1s",
          }}>{k}</button>
        );
      })}
    </div>
  );
}
