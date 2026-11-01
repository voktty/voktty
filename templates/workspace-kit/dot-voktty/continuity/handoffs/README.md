# Handoffs

One file per session that changed something, written in the project
language. The newest file is the first thing a resuming session reads.

File name: `YYYY-MM-DD-HHMM-<agent>.md`, in UTC, so names sort by time. Use
`solo` as the agent name when working without a team.

The shared measurement parser derives age from this UTC filename, independent
of filesystem timestamps that can change on copy or clone. It accepts valid
dates from 1970 through 9999 and basenames up to 256 UTF-8 bytes. A malformed
name has an unknown age; it is never treated as a newly created handoff.

Format and when to write one: `../../capture/handoff.md`.

Handoffs are history and are not edited. Older ones move unchanged to
`../../archive/YYYY-MM/` when this folder passes its limits in
`../../kit.json` (`../../capture/compact.md`).
