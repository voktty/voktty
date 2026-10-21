# Architecture standards

Cross-cutting standards of the project: the rules that apply to more than
one component. Typical subjects: where the truth of each kind of data lives,
authentication and accounts, the technology stack for new components, API
conventions, error handling, logging, internationalization.

Write one file per standard, in the project language. Each one states the
rule, the reason and the components it applies to. Read the relevant
standard when you create a component or connect two.

Component-specific detail belongs in `../domains/`.
