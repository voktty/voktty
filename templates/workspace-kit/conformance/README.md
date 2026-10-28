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
expected custom issue code in the corpus. Structural failures retain Zod's
issue codes and field paths. Document-level failures do not echo the input
text or a JSON parser's source excerpt.

Structural JSON Schema checks alone cannot enforce all these cases. Names,
inherited runtime constraints, matching stored values, ownership overlap
and Unicode scalar validity also require semantic checks. Lexical ownership
does not resolve symlinks, grant filesystem access or approve a command.

The TypeScript consumer runs this corpus. Rust must run the same cases when
its implementation is added; native parity has not yet been verified.
