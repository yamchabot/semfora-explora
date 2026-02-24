"""
report.py  —  HTML report generator for user simulation results

Generates a single self-contained HTML file showing:
  - A card per person with their avatar, role, goal, and Z3 constraints
  - A grid of coloured balls (one per scenario) showing pass/fail
  - JS tooltips explaining what failed in each scenario

Usage:
    from user_simulation.report import generate_report
    generate_report(results_by_scenario, "report.html")

Or via run.py (auto-generates alongside the text output).
"""

from __future__ import annotations
import html as html_mod
import json
import math
from pathlib import Path


# ── Avatar configuration ──────────────────────────────────────────────────────

# DiceBear style per pronoun, background colours per person
_AVATAR_STYLE = {
    "she":  "lorelei",
    "he":   "adventurer",
    "they": "micah",
}
_BG_COLOURS = {
    # name → hex without #
    "Sarah":  "ffd6e0",
    "Marcus": "c2d4f0",
    "Priya":  "d4edda",
    "Jordan": "fff3cd",
    "Kenji":  "d1ecf1",
    "Fatima": "e2d9f3",
    "Alex":   "fde8d8",
    "Dana":   "e8f4f8",
    "Taylor": "f0f4e8",
}
_PRONOUN_DISPLAY = {
    "she":  "she/her",
    "he":   "he/him",
    "they": "they/them",
}


def _avatar_url(person) -> str:
    style = _AVATAR_STYLE.get(person.pronoun, "micah")
    bg    = _BG_COLOURS.get(person.name, "e0e0e0")
    return (
        f"https://api.dicebear.com/9.x/{style}/svg"
        f"?seed={person.name}&backgroundColor={bg}&radius=50"
    )


# ── Constraint formatting ─────────────────────────────────────────────────────

def _fmt_expr(expr) -> str:
    """Render a Z3/compat expression as readable text."""
    op = getattr(expr, '_op', None)
    if op == '=>':
        a, b = expr._args
        return f"If {_fmt_expr(a)}, then {_fmt_expr(b)}"
    if op == 'and':
        return " AND ".join(_fmt_expr(a) for a in expr._args)
    if op == 'or':
        return " OR ".join(_fmt_expr(a) for a in expr._args)
    if op == 'not':
        return f"NOT ({_fmt_expr(expr._args[0])})"
    s = expr.sexpr() if hasattr(expr, 'sexpr') else str(expr)
    s = s.replace(' >= ', ' ≥ ').replace(' <= ', ' ≤ ')
    return s


def _get_constraints(person) -> list[tuple[str, bool]]:
    """
    Return [(display_text, is_implies), ...] from a person's formula conjuncts.
    """
    from .judgement import _conjuncts
    result = []
    for c in _conjuncts(person.formula):
        op = getattr(c, '_op', None)
        text = _fmt_expr(c)
        result.append((text, op == '=>'))
    return result


# ── Data assembly ─────────────────────────────────────────────────────────────

def _build_person_data(
    person,
    person_results: dict,
    scenarios: list[str],
) -> dict:
    """Build the JSON payload for one person card."""
    balls = []
    n_pass = 0
    for s in scenarios:
        r = person_results[s]
        passed = r.satisfied
        n_pass += int(passed)
        balls.append({
            "scenario": s,
            "passed":   passed,
            "failures": r.failed_descriptions if not passed else [],
        })

    constraints = _get_constraints(person)

    return {
        "name":        person.name,
        "role":        person.role,
        "pronoun":     _PRONOUN_DISPLAY.get(person.pronoun, person.pronoun),
        "goal":        person.goal,
        "avatar":      _avatar_url(person),
        "n_pass":      n_pass,
        "n_total":     len(scenarios),
        "constraints": [{"text": t, "implies": imp} for t, imp in constraints],
        "balls":       balls,
    }


# ── HTML template ─────────────────────────────────────────────────────────────

_CSS = """
:root {
  --bg:      #0d1117;
  --card:    #161b22;
  --card2:   #1c2128;
  --border:  #30363d;
  --text:    #e6edf3;
  --muted:   #8b949e;
  --pass:    #3fb950;
  --fail:    #f85149;
  --blue:    #58a6ff;
  --orange:  #ffa657;
  --mono:    'SF Mono', 'Consolas', 'Menlo', monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: var(--bg);
  color: var(--text);
  padding: 32px 24px;
  min-height: 100vh;
}

header {
  border-bottom: 1px solid var(--border);
  padding-bottom: 20px;
  margin-bottom: 28px;
}

header h1 {
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 6px;
}

.summary {
  font-size: 13px;
  color: var(--muted);
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}
.summary strong { color: var(--text); }
.summary .s-pass { color: var(--pass); font-weight: 600; }
.summary .s-fail { color: var(--fail); font-weight: 600; }

/* ── Person card ─────────────────────────────────────────── */
.card {
  display: grid;
  grid-template-columns: 130px 1fr 260px;
  gap: 0;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px;
  margin-bottom: 14px;
  overflow: hidden;
}

/* Left: avatar + identity */
.identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 16px;
  gap: 8px;
  border-right: 1px solid var(--border);
  background: var(--card2);
}

.avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 2px solid var(--border);
  background: #2d333b;
  object-fit: cover;
}
.card.all-pass  .avatar { border-color: var(--pass); box-shadow: 0 0 0 3px rgba(63,185,80,.18); }
.card.some-fail .avatar { border-color: var(--fail); box-shadow: 0 0 0 3px rgba(248,81,73,.12); }

.person-name { font-size: 14px; font-weight: 700; text-align: center; }
.person-role { font-size: 10px; color: var(--muted); text-align: center; line-height: 1.4; }
.pronouns    { font-size: 10px; color: var(--border); font-style: italic; text-align: center; }

.pass-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 10px;
  margin-top: 2px;
}
.badge-all  { background: rgba(63,185,80,.2);  color: var(--pass); }
.badge-some { background: rgba(248,81,73,.15); color: var(--fail); }

/* Middle: goal + constraints */
.constraints-panel {
  padding: 18px 20px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.goal-text {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}

.constraints {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.constraint {
  font-family: var(--mono);
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 5px;
  background: #0d1117;
  border: 1px solid var(--border);
  color: var(--blue);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
.constraint.implies { color: var(--orange); }

/* Right: scenario grid */
.grid-panel {
  padding: 16px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.grid-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted);
}
.grid-score { font-weight: 600; font-size: 12px; }
.grid-score .n-pass { color: var(--pass); }
.grid-score .n-fail { color: var(--fail); }

.balls {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-content: flex-start;
}

.ball {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform .12s, filter .12s;
}
.ball:hover { transform: scale(1.55); filter: brightness(1.2); z-index: 5; }
.ball.pass  { background: var(--pass); }
.ball.fail  { background: var(--fail); opacity: .75; }
.ball.fail:hover { opacity: 1; }

/* Legend */
.legend {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 10px;
  color: var(--muted);
}
.leg-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
}
.leg-pass { background: var(--pass); }
.leg-fail { background: var(--fail); }

/* ── Tooltip ─────────────────────────────────────────────── */
#tooltip {
  position: fixed;
  background: #1c2128;
  border: 1px solid #444c56;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12px;
  max-width: 340px;
  pointer-events: none;
  z-index: 9999;
  box-shadow: 0 8px 28px rgba(0,0,0,.5);
  display: none;
  line-height: 1.5;
}
#tooltip .tip-scenario { font-weight: 700; color: var(--blue); margin-bottom: 5px; }
#tooltip .tip-pass     { color: var(--pass); }
#tooltip .tip-fail     { color: var(--fail); margin-top: 3px; font-size: 11px;
                          font-family: var(--mono); }
"""

_JS = """
const DATA = %DATA%;

const tip = document.getElementById('tooltip');

document.querySelectorAll('.ball').forEach(ball => {
  const personIdx   = +ball.dataset.person;
  const scenarioIdx = +ball.dataset.scenario;
  const pd = DATA[personIdx];
  const sd = pd.balls[scenarioIdx];

  ball.addEventListener('mouseenter', e => {
    let inner = `<div class="tip-scenario">${sd.scenario}</div>`;
    if (sd.passed) {
      inner += `<div class="tip-pass">✓ passed</div>`;
    } else {
      inner += `<div style="color:#8b949e;margin-bottom:3px">✗ failed</div>`;
      sd.failures.forEach(f => {
        inner += `<div class="tip-fail">• ${f}</div>`;
      });
    }
    tip.innerHTML = inner;
    tip.style.display = 'block';
    moveTip(e);
  });
  ball.addEventListener('mousemove', moveTip);
  ball.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
});

function moveTip(e) {
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + 340 > window.innerWidth)  x = e.clientX - 340 - pad;
  if (y + 200 > window.innerHeight) y = e.clientY - 200 - pad;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}
"""


def _person_card_html(pd: dict, person_idx: int) -> str:
    passed_all = pd["n_pass"] == pd["n_total"]
    card_cls   = "all-pass" if passed_all else "some-fail"
    badge_cls  = "badge-all" if passed_all else "badge-some"
    badge_txt  = f"{pd['n_pass']}/{pd['n_total']}"

    # Avatar
    identity = f"""
      <div class="identity">
        <img class="avatar" src="{pd['avatar']}" alt="{pd['name']}"
             onerror="this.style.background='#2d333b'" />
        <div class="person-name">{pd['name']}</div>
        <div class="person-role">{pd['role']}</div>
        <div class="pronouns">{pd['pronoun']}</div>
        <div class="pass-badge {badge_cls}">{badge_txt} scenarios</div>
      </div>
    """

    # Constraints
    c_html = ""
    for c in pd["constraints"]:
        cls = "constraint implies" if c["implies"] else "constraint"
        c_html += f'<div class="{cls}">{html_mod.escape(c["text"])}</div>\n'

    constraints_panel = f"""
      <div class="constraints-panel">
        <div class="goal-text">{html_mod.escape(pd['goal'])}</div>
        <div class="constraints">{c_html}</div>
      </div>
    """

    # Ball grid
    n_fail = pd["n_total"] - pd["n_pass"]
    balls_html = ""
    for si, b in enumerate(pd["balls"]):
        cls = "ball pass" if b["passed"] else "ball fail"
        balls_html += (
            f'<div class="{cls}" data-person="{person_idx}" '
            f'data-scenario="{si}" title="{html_mod.escape(b["scenario"])}"></div>\n'
        )

    grid_panel = f"""
      <div class="grid-panel">
        <div class="grid-header">
          <div class="legend">
            <span class="leg-dot leg-pass"></span> pass
            <span class="leg-dot leg-fail"></span> fail
          </div>
          <div class="grid-score">
            <span class="n-pass">{pd['n_pass']}</span>
            <span style="color:var(--muted)"> / </span>
            <span class="n-fail">{pd['n_total']}</span>
          </div>
        </div>
        <div class="balls">{balls_html}</div>
      </div>
    """

    return f'<div class="card {card_cls}">{identity}{constraints_panel}{grid_panel}</div>'


def generate_report(
    results_by_scenario: dict,
    output_path: str | Path = "user_simulation_report.html",
) -> Path:
    """
    Generate an HTML report from run.py results.

    Args:
        results_by_scenario: {scenario_name: [CheckResult, ...]} from run_pipeline()
        output_path:         where to write the HTML file

    Returns:
        Path to the written file.
    """
    from .users import ALL

    scenarios   = list(results_by_scenario.keys())
    n_scenarios = len(scenarios)
    n_people    = len(ALL)

    # Transpose: one dict per person
    by_person = [
        {s: results_by_scenario[s][i] for s in scenarios}
        for i in range(n_people)
    ]

    # Build per-person data
    person_data = [
        _build_person_data(ALL[i], by_person[i], scenarios)
        for i in range(n_people)
    ]

    # Summary stats
    total   = n_people * n_scenarios
    n_pass  = sum(pd["n_pass"] for pd in person_data)
    n_fail  = total - n_pass
    pct     = int(100 * n_pass / total) if total else 0

    # Build cards
    cards_html = "\n".join(
        _person_card_html(pd, i)
        for i, pd in enumerate(person_data)
    )

    # Embed data for JS tooltips
    js_data = json.dumps(person_data, ensure_ascii=False)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>User Simulation Report</title>
  <style>{_CSS}</style>
</head>
<body>

<header>
  <h1>🐉 User Simulation Report</h1>
  <div class="summary">
    <span><strong>{n_pass}</strong> / <strong>{total}</strong> person×scenario checks satisfied ({pct}%)</span>
    <span><span class="s-pass">{n_pass} passed</span> &nbsp; <span class="s-fail">{n_fail} failed</span></span>
    <span><strong>{n_scenarios}</strong> scenarios &nbsp; <strong>{n_people}</strong> people</span>
  </div>
</header>

{cards_html}

<div id="tooltip"></div>

<script>
{_JS.replace('%DATA%', js_data)}
</script>
</body>
</html>
"""

    out = Path(output_path)
    out.write_text(html, encoding="utf-8")
    return out
