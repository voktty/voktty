# Validation conformance

`validation.json` describes schema 1 cases for the kit's structural and
semantic validators. It is test data, not deployed project memory.

Each consumer renders the source template with the top-level `values`, then
chooses `kit.json` or `team/agents.json` using `target`. Apply each `changes`
entry to its explicit property path: `value` replaces or creates an own
property; `remove` removes it. An own `__proto__` property must remain data,
not a prototype assignment. Serialize the result as JSON.

An optional `rawEdit` then replaces its one exact `find` occurrence with
`with`. This supplies malformed Unicode escapes without requiring a runtime
to represent an invalid Unicode string in its parsed fixture values.

Run the complete validator and compare `valid`. For rejections, `issue`,
when present, is an expected field path among the reported issues. Empty
paths identify document-level failures. `pathCase` is the explicit lexical
ownership comparison policy; cases without it use `sensitive` in the test
harness. Production callers must obtain this policy from their filesystem
context, not guess it from a path.

Custom validation issues carry stable `KIT_*` codes in their `message` field;
presentation translates those codes. An optional `customCode` identifies an
expected custom issue code in the corpus. TypeScript structural failures retain
Zod's issue codes; Rust uses `KIT_SCHEMA_VALIDATION`. Both retain field paths.
Document-level failures do not echo the input
text or a JSON parser's source excerpt.

Structural JSON Schema checks alone cannot enforce all these cases. Names,
inherited runtime constraints, matching stored values, ownership overlap
and Unicode scalar validity also require semantic checks. Lexical ownership
does not resolve symlinks, grant filesystem access or approve a command.

Both TypeScript and Rust run this corpus. `rendering.json` adds valid and
invalid rendering inputs and SHA-256 hashes of every rendered file, including
optional root links. Each valid case must match its complete ordered file
list, roles and byte hashes; a changed template requires a reviewed fixture
update. These checks do not certify native deployment, filesystem authority
or process launching.

`deployment.json` describes complete pure deployment previews against explicit
path facts (`absent`, readable `file`, or `blocked`). Both cores compare every
ordered entry, expected and proposed text, action, reason and publication flag.
Root links require separate opt-ins. Missing facts reject the preview, while
blocked paths and ambiguous marked blocks remain conflicts. The fixtures cover
UTF-8 and CRLF preservation and migration of a wildcard ignore to an allowlist.
These observations do not authorize writes or certify that a filesystem has
remained unchanged. A native writer must revalidate them under its destination
exclusion before publishing the kit marker.
