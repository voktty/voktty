# Stateless local memory measurements

`measure_local_memory` resolves one ready ancestor kit with the common scope
resolver and returns its root and the pure core's `MemoryMeasurements` report.
It never opens private preferences, initializes an installation, changes trust
or use policy, delivers context, captures, archives or compacts project files.
It reads configuration and configured limits for `CONTEXT.md`, `PROJECT.md`,
`plans/INDEX.md`, `plans/TRACKING.md` and `continuity/CHANGELOG.md`. Instruction
bodies, runtime state, sessions and handoff bodies are outside its read inventory.

The caller supplies captured native metadata, read and enumeration authority,
the current UTC milliseconds and the exact translated Up next heading. These
arguments do not grant filesystem access. Local transport and secret-path
checks remain mandatory; remote namespaces cannot fall back to this API.
Absent, reserved, ambiguous, invalid or incomplete scopes fail without measuring
an arbitrary root or treating missing memory as zero. The operation is stateless
and requires no stored installation identity or session consent.

Each call retains one of the existing four native read permits until settlement.
It shares the original discovery cancellation/deadline, at most fifteen seconds
overall with individual phases capped at five seconds. Kernel filesystem calls
are not interruptible. Asynchronous applications must retain their own bounded
worker and original presentation authority through settlement; this synchronous
API must not run on the UI thread.

The native reader retains its 256 KiB UTF-8 per-file limit. Configuration plus
the five documents have a 1.5 MiB aggregate limit. Initial and final scope discovery
retain their existing separate bounded ancestor configuration-read budgets.
The fixed handoff directory
listing admits at most 20,000 entries plus one overflow observation, without
recursive traversal. Entries require separate metadata and listing authority.
Only regular Markdown files other than README contribute to handoff counts.
Dates come from `handoff_created_at_ms`, never filesystem timestamps. Unknown
or future dates produce an unknown age. Missing or incomplete inventories,
unrepresentable names and Markdown links/special entries produce unknown
inventory metrics. Missing or blocked documents remain unknown, never empty.

Directory traversal uses the existing no-follow Unix descriptors or Windows
handles. Root, kit and relevant fixed subdirectory objects, instances and
directory revisions are revalidated around scope verification. Configuration
bytes are reread, and content/listing authority is checked before returning.
Changed roots, configuration, scopes or retired authority reject the result.
These are bounded point-in-time observations, not an atomic filesystem snapshot
or proof that external writers cannot change content after it was measured.

Linux tests cover actual limits, Unicode, ancestor scope, no writes, restricted
read inventory, unknown data, cancellation, revocation, late replacement,
symlinks and enumeration limits. Windows, macOS and Android runtime qualification
remains pending. The standalone `memory measure` CLI delegates to this API;
there is no measurement IPC method or automatic compaction trigger yet.
