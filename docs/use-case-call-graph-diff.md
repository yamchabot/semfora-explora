# Use Case: Call Graph Diff

## The Problem

When reviewing a pull request — especially AI-generated code — text diffs tell you *what lines changed* but not *what dependencies changed*. A three-line change in a utility function can rewire how a dozen other modules behave. A text diff won't show you that. An experienced engineer will *sometimes* catch it. A junior reviewer almost never will.

This is the original problem that motivated building Semfora.

## What Semfora Enables

Semfora can produce a call graph snapshot for any commit or branch. By comparing two snapshots, we get a **structural diff** of the code — not the text, but the actual dependency wiring.

## The Feature

**Call Graph Diff Viewer**

Given two refs (branches, commits, tags), show:

- 🟢 **New edges** — call relationships that didn't exist before
- 🔴 **Removed edges** — call relationships that were deleted
- 🟡 **Modified nodes** — functions whose signature or body changed
- ⚫ **Deleted nodes** — functions that no longer exist
- ✨ **New nodes** — functions that were added

Rendered as a side-by-side or overlay graph visualization with the changed elements highlighted.

**Secondary views:**
- A flat list (for large changes where the graph is too busy)
- Filterable by: file, module, change type
- "Impact score" per changed node based on betweenness centrality — prioritizes the scary changes

## Why It's Useful

- Immediately shows reviewers *what actually changed architecturally*, not just textually
- Makes AI-generated code reviews tractable — you can see if the AI respected module boundaries
- Catches accidental dependency creep ("why is the auth module now calling the email module?")
- Surfaces hidden coupling introduced through innocuous-looking refactors

## Who Uses This

**Code reviewer** doing a PR review. They open the diff view, paste in the branch name, and see a structural summary alongside the text diff. They can focus their review energy on the high-betweenness nodes that changed.

## Mockup

See: `mockups/call-graph-diff.html`
