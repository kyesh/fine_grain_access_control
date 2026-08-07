# Planned capability docs (not yet in the coverage inventory)

Drafted QA capability docs for features from
`docs/implementation_plans/connector-growth_v1.md` that have not shipped yet.

`scripts/qa-coverage-check.ts` builds its assertion inventory from
`../capabilities/NN_*.md` only — files here are intentionally invisible to it,
so QA runs stay green until each feature lands.

**Promotion rule**: the PR that ships a feature MUST move its doc into
`../capabilities/` (and, for 06, replace the existing file). From that moment
the coverage checker requires evidence for every assertion in it.

| File | Ships with | Action on ship |
|---|---|---|
| `06_connection_lifecycle_v2.md` | Phase B (instant-start) | REPLACES `../capabilities/06_connection_lifecycle.md` |
| `11_default_profile_instant_start.md` | Phase B | Move into `../capabilities/` |
| `12_magic_link_approvals.md` | Phase C | Move into `../capabilities/` |
| `13_request_access_tool.md` | Phase D | Move into `../capabilities/` |
