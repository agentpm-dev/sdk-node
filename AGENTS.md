# `agentpm-sdk-node` Repo Guide

This repo is the Node SDK for AgentPM. It owns Node-side tool discovery, subprocess execution, runtime environment handling, and optional framework adapters for Node consumers.

## Local Rules

- Open source.
- npm distribution and package shape matter.
- The published contract includes dual ESM/CJS builds and bundled type declarations.
- Optional integrations must remain optional.

## Builder Guidance

- Be conservative with SDK contracts.
- Prefer narrow, localized diffs.
- Avoid broad refactors unless the task clearly requires them or the user asked for them.
- Keep runtime behavior predictable and deterministic.
- Preserve subprocess, interpreter, and env semantics carefully.
- Keep error messages useful and specific when contract surfaces fail.
- Update tests and README examples when behavior changes.

## Important Files And Contract Surfaces

- `src/index.ts`: core `load()` implementation, tool resolution, runtime checks, env merging, subprocess execution, and error behavior.
- `src/adapters/langchain.ts`: optional LangChain adapter surface; must not become a core runtime dependency.
- `test/load.spec.ts`: contract-focused tests for loading, env requirements, interpreter allowlists, and adapter behavior.
- `package.json`: npm package exports, optional peer dependency shape, scripts, and publish contract.
- `tsup.config.ts`: ESM/CJS build output contract.
- `README.md`: user-facing SDK contract and example usage.

## Common Patterns In This Repo

- The public surface is centered on `load()`.
- Tool loading is strict about interpreter allowlists, runtime matching, env requirements, and helpful errors.
- Caller env and entrypoint env are merged intentionally; changes here are contract-sensitive.
- Tool invocation is subprocess-based and exchanges JSON over stdin/stdout.
- Optional integrations like LangChain should remain adapters, not core runtime requirements.
- The npm package publishes built `dist/` artifacts in both CJS and ESM forms with types.
- Tool stdout may contain logs/noise, but invocation expects a final JSON object to parse as the tool result.
- Tool logs should go to stderr; stdout parsing behavior is contract-sensitive.
- Exported TypeScript types are part of the public SDK contract.

## Common Workflows

### When changing tool loading or invocation behavior

1. Start in `src/index.ts`.
2. Trace the change through resolution order, manifest parsing, interpreter validation, env merging, and subprocess execution.
3. Preserve discovery order and deterministic behavior unless the task intentionally changes them.
4. Keep error messages explicit when contract validation fails.
5. Update `test/load.spec.ts` to match the changed behavior.

Example:

- The existing tests already cover unsupported interpreters, missing required env vars, and non-zero exit behavior; changes in `load()` should usually extend those tests.

### When changing env handling or runtime validation

1. Start in the env merge and interpreter helper logic in `src/index.ts`.
2. Treat `process.env`, manifest entrypoint env, and caller-supplied env as layered contract behavior.
3. Be careful not to weaken required-env enforcement or runtime-type matching by accident.
4. Update tests and README examples if the expected calling pattern changes.

### When changing the LangChain adapter

1. Start in `src/adapters/langchain.ts`.
2. Keep adapter assumptions separate from the core runtime path.
3. Preserve the optional peer dependency model in `package.json`.
4. Do not let adapter-specific abstractions leak back into `src/index.ts` without a clear reason.

### When changing npm/package output behavior

1. Start with `package.json` and `tsup.config.ts`.
2. Preserve the ESM/CJS/types export contract unless the task explicitly changes it.
3. Treat build outputs and publish surface as user-facing contract behavior.
4. Check whether README installation or import examples need to change.

## Decision Guide

| If the change is about...         | Start here                  | Also inspect                                        |
| --------------------------------- | --------------------------- | --------------------------------------------------- |
| core SDK loading behavior         | `src/index.ts`              | `test/load.spec.ts`, README examples                |
| env merging or runtime validation | `src/index.ts` helper logic | manifest/runtime assumptions, tests, error messages |
| LangChain integration             | `src/adapters/langchain.ts` | `package.json` peer deps, tests, README             |
| npm packaging or exports          | `package.json`              | `tsup.config.ts`, README import examples            |
| user-facing SDK usage docs        | `README.md`                 | corresponding code paths and tests                  |

## Do / Don’t

- Don’t change `load()` behavior casually.
  - Do treat it as the primary public API surface and verify the end-to-end contract.
- Don’t weaken subprocess or env semantics by accident.
  - Do trace changes through interpreter checks, env merging, stdin/stdout handling, and exit behavior.
- Don’t let optional adapters become hidden core requirements.
  - Do keep adapter-specific logic isolated and package metadata explicit.
- Don’t change npm export or build output shape casually.
  - Do treat ESM/CJS/types behavior as part of the public package contract.
- Don’t let README examples drift from the actual SDK usage model.
  - Do update usage docs when imports, options, or calling conventions change.
- Don’t casually change stdout parsing behavior.
  - Do preserve the final-JSON result contract and update tests if parsing behavior changes.

## Verification

- Use the repo-native commands from `package.json`, especially `pnpm test`, `pnpm build`, and `pnpm lint`.
- Verify load/runtime behavior when changing tool resolution, env handling, subprocess execution, adapters, or package exports.
- Treat README examples as part of the contract when usage behavior changes.

## Never Do This

- Never change SDK contracts casually.
- Never regress tool discovery, env passing, or subprocess behavior without updating tests.
- Never turn optional adapters into implicit core dependencies.
- Never change published package shape without treating it as a compatibility event.
- Never remove or rename exported types/options without treating it as a compatibility event.
