# Handoffs

One file per session that changed something, written in the project
language. The newest file is the first thing a resuming session reads.

File name: `YYYY-MM-DD-HHMM-<agent>.md`, in UTC, so names sort by time. Use
`solo` as the agent name when working without a team.

Format and when to write one: `../../capture/handoff.md`.

Handoffs are history and are not edited. Older ones move unchanged to
`../../archive/YYYY-MM/` when this folder passes its limits in
`../../kit.json` (`../../capture/compact.md`).
