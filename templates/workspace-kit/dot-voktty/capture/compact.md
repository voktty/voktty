# Capture: compact and archive

Live files are reread by every session, so their size is paid on every
start. When asked to compact or archive memory, use the limits in
`../kit.json` to identify candidates. Closed history moves to the archive
and live files describe the current state. A configured limit does not mean
a background compaction service exists.

Respect assigned ownership, reserve the affected paths and `memory` resource
for the work (`../team/MESSAGING.md`) and keep a recoverable before-copy.
Write in the project language.

## Item ids

Pending items, decisions and questions in live files carry an id so a script
can check that none is lost:

- `[T-12]` a task or pending item;
- `[D-4]` a decision that still applies;
- `[Q-3]` something waiting on {owner_title}.

Ids are never reused. Mark a finished item `[T-12 done]` instead of deleting
it; compaction moves it to the archive.

## Archive

1. Candidates are closed and older than `archive.afterDays`: handoffs, plans
   marked closed, finished items of the tracking board, changelog entries.
   **Anything open is never archived, however old.**
2. Move each one unchanged to `archive/YYYY-MM/` (the month it closed, or
   the month of the handoff), keeping its file name. Whole files are moved,
   not rewritten. Items cut from a live file are appended unchanged to
   `archive/YYYY-MM/<live file name>`.
3. Where it was, leave one line with a link: "Archived: [T-12 upload retry,
   closed 2030-01-10](archive/2030-01/TRACKING.md)".

## Compact

Rewrite the live file as a summary of the current state: what exists, what
is left, who does it, and which decisions still apply with their reasons.
History stays in the archive.

Never lose a decision, a pending item or a reason. If unsure whether
something still matters, keep it live.

## Record

Append one line to `archive/LOG.md`: date, agent, what moved and where, and
the size of each live file before and after.

## Check

Compare the before-copy with the result: every open item must still be in
a live file, every other id must be live or archived, and every plan not
closed must be listed in `plans/INDEX.md`. Check the reasons, links and
archived bytes as well as the IDs. Use a verified checker when available;
do not assume that a `voktty memory check` command is installed. Record
manual and automated checks separately. If something was lost, restore
only your changes from the before-copy without overwriting concurrent work,
report the failure and release your reservations. Do not weaken the check.
