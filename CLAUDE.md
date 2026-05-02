# `agentpm-sdk-node` Repo Review Guide

This repo is the Node runtime integration layer for AgentPM. Reviews should prioritize `load()` contract stability, subprocess/env/runtime correctness, npm package compatibility, and keeping optional adapters isolated from the core runtime.

## Review Focus

- load-path correctness
- subprocess behavior
- env passing behavior
- runtime and interpreter validation behavior
- SDK contract stability
- npm-facing compatibility risk
- optional adapter isolation from core behavior
- README/example drift from actual usage

## Review Principles

- Treat `load()` as the primary public API surface.
- Review runtime changes end-to-end: resolution -> manifest/runtime checks -> env merge -> subprocess invocation -> JSON result/error handling.
- Treat package exports and build outputs as compatibility surfaces, not implementation details.
- Prefer findings about contract drift, determinism, compatibility, and runtime correctness over style.

## Blocking Issues

- broken load semantics
- env handling regressions
- subprocess contract regressions
- runtime or interpreter validation regressions
- unintended public API drift
- npm export or package-shape regressions
- adapter changes that make optional integrations effectively required
- stale or misleading README usage examples after behavior changes

## Specific Review Checks

- If `src/index.ts` changed, review resolution order, interpreter allowlists, env merging, subprocess behavior, and error wording together.
- If env handling changed, verify required-env enforcement and precedence between process env, manifest env, and caller env.
- If subprocess behavior changed, review stdin/stdout JSON contract, timeout handling, exit-code behavior, and error surfaces together.
- If `src/adapters/langchain.ts` changed, verify that the adapter still remains optional and that no core runtime assumptions were introduced.
- If `package.json` or `tsup.config.ts` changed, review ESM/CJS/types exports and peer dependency behavior as compatibility surfaces.
- If README usage examples changed, verify that they still match the actual package contract.

## Decision Guide

| If the review touches...  | Focus first on...                  | Also inspect                                             |
| ------------------------- | ---------------------------------- | -------------------------------------------------------- |
| core loading behavior     | `load()` contract stability        | tests, README usage, runtime helper logic                |
| env or runtime validation | precedence and determinism         | required-env behavior, interpreter checks, tests         |
| subprocess invocation     | JSON contract and failure behavior | timeouts, exit codes, stderr/stdout handling             |
| LangChain adapter         | optionality and isolation          | peer dependency metadata, core runtime boundaries        |
| npm packaging or exports  | compatibility and publish shape    | `package.json`, `tsup.config.ts`, README import examples |

## Do / Don’t

- Don’t review helper changes in isolation when they affect `load()`.
  Do follow them through the full runtime contract and its tests.
- Don’t treat env or subprocess behavior as incidental implementation detail.
  Do review it as a caller-visible SDK contract.
- Don’t accept adapter changes that quietly reshape the core SDK.
  Do enforce the boundary between optional integrations and core runtime behavior.
- Don’t ignore package export changes as build noise.
  Do treat them as compatibility-sensitive public API changes.

## Low-Value Review Noise

- avoid style-only comments unless they hide compatibility or runtime risk
- avoid speculative refactor suggestions unless the current change clearly weakens determinism or maintainability
