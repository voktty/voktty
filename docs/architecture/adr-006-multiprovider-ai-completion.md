# ADR-006: Multiprovider AI completion adapters

## Status

Accepted.

## Context

Voktty exposes one user-selected autocomplete model across native cloud providers, local runtimes and OpenAI-compatible endpoints. These endpoints do not share one reasoning-control option. Sending a vendor-specific option to every model can fail, while allowing a reasoning model to spend the complete token budget internally can return no visible code.

Autocomplete must remain low latency, must not switch provider or model without consent and must not make editor availability depend on an AI endpoint.

## Decision

The editor resolves the selected model into a protocol profile before every completion. Native providers infer their profile from the provider id. Named OpenAI-compatible endpoints can select automatic detection, generic, OpenAI, DeepSeek, Ollama or LM Studio behavior.

Each profile produces one or two bounded attempts for the same model:

- The first attempt uses the cheapest protocol-safe reasoning policy and a small output budget.
- A second attempt runs only after an empty response or rejected optional parameter.
- Authentication, quota and network failures are not retried.
- No failure changes provider, endpoint or model.

Ollama and LM Studio capabilities are queried only by an explicit health test, cached for five minutes and reused by editor requests. Other providers rely on their adapter contract because there is no common capability endpoint.

Three consecutive unusable results pause automatic requests for 60 seconds. A manual request can bypass the pause to test recovery. This circuit is local to the mounted editor and never blocks CodeMirror, LSP or file editing.

Settings runs the real completion pipeline with a fixed code fixture and reports the selected profile, latency, attempts and a bounded text sample. Secrets remain in the existing keyring and are never displayed.

## Consequences

Adding a provider requires a contract test for its completion profile. OpenAI-compatible services can remain generic or opt into an explicit profile without adding another provider implementation. Unsupported or offline AI features degrade visibly while the editor remains usable.

The design accepts one additional request after a narrow class of failures. Requests remain capped at two attempts and 1,024 output tokens per attempt.

## Rejected alternatives

- A universal `thinking` flag was rejected because providers use incompatible option names and values.
- Silent fallback to another configured provider was rejected because it changes cost, privacy and data destination.
- Capability discovery on every keystroke was rejected because it adds latency and local network traffic to the hot path.
- Unlimited SDK retries were rejected because they hide cost and make completion latency unpredictable.

