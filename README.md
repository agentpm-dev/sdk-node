# AgentPM™ Node SDK

A lean, framework-agnostic **Node.js SDK** for running **AgentPM** tools and inspecting installed agent, Knowledge, Memory, Profile, and Loop packages from your app or agent runtime.

- 🔎 **Discovers** tools installed by `agentpm install` in `.agentpm/tools` (project) and `~/.agentpm/tools` (user), with `AGENTPM_TOOL_DIR` override.
- 📦 **Loads installed agents** from `.agentpm/agents` and exposes their resolved tool and skill refs from `agent.lock`.
- 📚 **Loads installed skills** from `.agentpm/skills` and exposes their manual content plus resolved tool refs.
- 🧠 **Loads installed Knowledge packages** from `.agentpm/knowledge` and exposes mode-specific metadata and canonical paths.
- ♾️ **Loads installed Memory packages** from `.agentpm/memory` and exposes authored blueprint metadata, build metadata, contract indexes, and resolved contract paths.
- 🎭 **Loads installed Profile packages** from `.agentpm/profiles` and exposes authored role, objective, and communication metadata.
- 🔁 **Loads installed Loop packages** from `.agentpm/loops` and exposes authored phase, transition, and error-policy metadata.
- 🚀 **Executes Tools** through `agentpm run --machine`, which owns Node/Python execution.
- 🧩 **Metadata-aware**: `withMeta` returns `func + meta` (name, version, description, inputs, outputs).
- 🧪 **Adapters**: tiny helpers (e.g. LangChain) without forcing extra deps.

> Requires **Node 20+**. Ships ESM + CJS builds. Types included.

---

## CLI and lock compatibility

SDK **0.1.17+** requires **AgentPM CLI 0.1.43+** for every Tool call,
including Node and older vendored Python Tools. Install the CLI separately and
check `agentpm --version`. Set `AGENTPM` to an absolute CLI executable path when
it is not on PATH; it is a single executable, not a shell command.

The SDK reads `agent.lock` **v2, v3 and v4** without rewriting it. Unsupported
future or malformed locks fail with update/install guidance. An installed Agent
can be loaded from a project containing just `agent.lock` and `.agentpm`; no app
`agent.json` is required. Exact locked references remain exact when other
versions coexist. A local author Tool root is not an installed Agent.

Calls follow **app → SDK → `agentpm run --machine` → Tool**. The SDK unwraps the
CLI result and returns the Tool's original JSON data. A Tool's `ok: false` stays
ordinary returned data; runner failures raise an exception. Interpreter, schema,
target, installed-state, timeout and managed-environment checks belong to the
CLI. They happen on invocation, so metadata loading itself needs no CLI or
available Tool interpreter. The SDK retains bounded input/output transport and
passes the requested timeout to the CLI. Ctrl-C is handled by the CLI's scoped
child cleanup; SDK interruption also terminates its CLI child.

Environment precedence is ambient values, defaults for missing variables,
entrypoint env, then caller env. Required variables may come from any of these
layers. Managed Python strips `PYTHONPATH` and `PYTHONHOME` after layering. Use
`AGENTPM_PYTHON` to select a compatible base interpreter **before install**, not
to bypass the managed environment. Caller options and credential values are not
printed in SDK debug output; credential values are redacted from CLI diagnostics.
Tool results are returned unchanged, so Tools must not return secrets themselves.

Run `agentpm install` explicitly to provision dependencies. If runtime state is
missing/stale, reinstall with the selected `AGENTPM_PYTHON`; use
`agentpm install --refresh` to repair damaged packages. Calls never auto-install,
resolve from an index, rewrite the lock or fall back to app/global Python.
Older SDK versions do not become v4-compatible merely because CLI install passed.

## Installation

Using **pnpm** (recommended):

```bash
pnpm add @agentpm/sdk
```

With npm:

```bash
npm i @agentpm/sdk
```

With yarn:

```bash
yarn add @agentpm/sdk
```

If you'll use the optional LangChain adapter:

```bash
pnpm add @langchain/core
# npm i @langchain/core
# yarn add @langchain/core
```

---

## Quick Start

### Minimal usage

```ts
import { load } from '@agentpm/sdk';

// spec format: "@scope/name@version"
const summarize = await load('@zack/summarize@0.1.0');

const result = await summarize({ text: 'Long document content...' });
console.log(result.summary);
```

### With metadata (build richer tool descriptions)

```ts
import { load, toLangChainTool } from '@agentpm/sdk';

const loaded = await load('@zack/summarize@0.1.0', { withMeta: true });
const { func: summarize, meta } = loaded;

const richDescription =
  `${meta.description ?? ''} ` +
  `Inputs: ${JSON.stringify(meta.inputs)}. ` +
  `Outputs: ${JSON.stringify(meta.outputs)}.`;

console.log(richDescription);
console.log((await summarize({ text: 'hello' })).summary);

// Optional: turn it into a LangChain tool (requires @langchain/core)
const lcTool = await toLangChainTool(loaded);
```

### Load an installed agent package

```ts
import {
  load,
  loadAgent,
  loadKnowledge,
  loadLoop,
  loadMemory,
  loadProfile,
  loadSkill,
} from '@agentpm/sdk';

const agent = await loadAgent('@zack/support-agent@0.1.0');
const docs = await loadKnowledge('@zack/python-docs@0.1.0');
const loop = await loadLoop('@zack/incident-response-loop@0.3.0');
const memory = await loadMemory('@zack/profile-memory@0.1.0');
const profile = await loadProfile('@zack/support-style@0.1.0');
const firstSkill = agent.resolvedSkills[0];
const skill = await loadSkill(`${firstSkill.name}@${firstSkill.version}`);
const firstTool = skill.resolvedTools[0];
const tool = await load(`${firstTool.name}@${firstTool.version}`);

console.log(agent.resolvedKnowledge);
console.log(agent.resolvedLoop);
console.log(agent.resolvedMemory);
console.log(agent.resolvedProfiles);
console.log(loop.loop.transitions);
console.log(docs.knowledge.mode);
console.log(memory.contracts);
console.log(profile.profile.communication);
```

`loadAgent()` returns:

- the installed agent manifest
- the installed agent root path
- `resolvedKnowledge` from `agent.lock`
- `resolvedLoop` from `agent.lock`
- `resolvedMemory` from `agent.lock`
- `resolvedProfiles` from `agent.lock`
- reserved refs (`knowledge`, `memory`, `profiles`) as metadata
- `resolvedTools` from `agent.lock`
- `resolvedSkills` from `agent.lock`

It does **not** execute the agent package or orchestrate the tools for you.

Compatibility note:

- `resolvedKnowledge` is populated from the modern first-class `root.knowledge` entries in `agent.lock`.
- `reserved.knowledge` is legacy pass-through metadata from older lockfile shapes. For current installs, treat `resolvedKnowledge` as the authoritative Knowledge dependency list and expect `reserved.knowledge` to usually be empty.
- If your workspace still has an older pre-Knowledge lockfile shape where Knowledge refs only exist under `reserved.knowledge`, rerun `agentpm install` to rewrite the lockfile before expecting `resolvedKnowledge` to be populated.
- `resolvedLoop` is populated from the modern first-class `root.loop` entry in `agent.lock`.
- `resolvedProfiles` is populated from the modern first-class `root.profiles` entries in `agent.lock`.
- `reserved.profiles` is legacy pass-through metadata from older lockfile shapes. For current installs, treat `resolvedProfiles` as the authoritative Profile dependency list and expect `reserved.profiles` to usually be empty.
- `manifest.loop` and `manifest.bindings` preserve the authored declarative metadata from the installed `agent.json`.

### Run Harness over the machine protocol

```ts
import { HarnessClient, type BeforeToolCallHookHandler } from '@agentpm/sdk';

const harness = new HarnessClient({
  agent: '@zack/support-agent@0.1.0',
  cwd: process.cwd(),
});

harness.registerModelProvider('company-model', async ({ request }) => ({
  id: 'turn-1',
  assistant_content: 'Handled by the host model.',
  actions: [],
  usage: {},
  finish_reason: 'stop',
  provider_metadata: { model: request.selection.model },
}));

const beforeToolCall: BeforeToolCallHookHandler = async (input) => ({
  decision: 'continue',
  patch: { arguments: input.arguments },
});

harness.onBeforeToolCall(beforeToolCall);

harness.onApproval(async () => 'approve');

const result = await harness.run('Use the configured agent.');
await harness.shutdown();

console.log(result);
```

`agent` is optional. When set, it is passed to `agentpm harness` as either an installed Agent package ref such as `@zack/support-agent@0.1.0` or a local manifest path such as `./agent.json`; when omitted, Harness uses its normal workspace discovery/default Agent selection. Register host services before starting a run. The SDK launches `agentpm harness --machine`, correlates request/response frames, streams Harness events, and routes host-service callbacks for model providers, embedding providers, Knowledge runtimes, hooks, and approvals.

The convenience Hook helpers use contract-specific types. `onBeforeModelRequest` may return `context_sections` and `provider_options`, `onBeforeToolSelection` may return `candidate_ids`, `onBeforeToolCall` may return replacement `arguments`, `onBeforeKnowledgeRequest` may shape the same package request options, and `onAfterKnowledgeRetrieval` may filter/reorder existing results or transform model-visible text while retaining result identity. Direct Memory hook helpers can shape authorized read requests or patch/reject authorized write content before runtime dispatch. A returned object must include `decision: 'continue'` or `decision: 'reject'`; returning `undefined` is treated as an explicit continue with no patch. There is no embedding Hook ID; use `registerEmbeddingProvider` to host query embedding.

Host capability advertisement is role-specific. `registerModelProvider` automatically advertises the registry ID as `provider` plus semantic-action, structured-output, multimodal-input, and usage-reporting flags; pass model-specific overrides such as `model` or `context_window_tokens` when known. `registerEmbeddingProvider` registers the `embed` provider contract and advertises supported embedding spaces. `registerKnowledgeRuntime` registers the `retrieve` runtime contract and advertises supported modes/features/package attestations. `registerHostProvider` remains available for lower-level role-specific capability shapes. `onApproval` advertises approval support and optional cancellation support. After initialization, `hostServiceRegistration(role, registryId)` exposes the Harness registration result, including `active: false` and a reason when Harness rejects a registration.

Host model providers receive the canonical `ModelRequest`. Use `request.prompt` as the system/control/context material and serialize `request.ordered_turns` as ordered provider turns: `user_input` as a user message, `assistant_content` as an assistant message, `semantic_action_call` as the provider's native tool/function call when `provider_call_id` and `provider_alias` are present, `semantic_action_result` as the correlated native tool/function result using the same `provider_call_id`, and `repair_feedback` as one model-visible user turn. Do not also flatten the Section 6 transcript or run input into a duplicate prompt message when ordered turns are serialized.

For CLI-launched custom Knowledge runtimes, use `serveKnowledgeRuntimeProcess(registryId, handler, capabilities)` to serve the public `agentpm-service` JSONL process protocol from a Node provider process. The Pinecone and pgvector reference providers live in <https://github.com/agentpm-dev/agentpm-examples/tree/main/knowledge-packages/m13-reference-providers>; they are examples to copy from, not provider-specific SDK exports.

For CLI-launched custom Memory runtimes, use `serveMemoryRuntimeProcess(registryId, handler, capabilities)` to serve the same public process protocol for MemoryRuntime methods: `read`, `write`, `count`, `load_operation_state`, `store_operation_state`, and `commit_lifecycle`. PostgreSQL/pgvector and Redis reference providers live in <https://github.com/agentpm-dev/agentpm-examples/tree/main/memory-packages/m16-reference-providers>; they are examples to copy from, not provider-specific SDK exports.

### Load an installed skill package

```ts
import { loadSkill } from '@agentpm/sdk';

const skill = await loadSkill('@zack/triage-playbook@0.1.0');

console.log(skill.entrypointPath);
console.log(skill.entrypointContent);
console.log(skill.references);
console.log(skill.scripts);
console.log(skill.resolvedTools);
```

`loadSkill()` returns an inspectable Skill object. Skills are **not** runnable SDK objects.

### Load an installed Knowledge package

```ts
import { loadKnowledge } from '@agentpm/sdk';

const knowledge = await loadKnowledge('@zack/python-docs@0.1.0');

console.log(knowledge.knowledge.mode);
console.log(knowledge.documentPaths);
console.log(knowledge.chunksPath);
console.log(knowledge.sourcesPath);
console.log(knowledge.vectorsPath);
console.log(knowledge.indexPaths);
```

`loadKnowledge()` returns an inspectable Knowledge object with:

- the installed knowledge manifest
- the installed package root path
- parsed `knowledge` metadata
- absolute paths for declared context documents, chunks, sources, vectors, indexes, and provenance when present

### Load an installed Memory package

```ts
import { loadMemory, loadMemoryContract } from '@agentpm/sdk';

const memory = await loadMemory('@zack/profile-memory@0.1.0');
const profileContract = loadMemoryContract(memory, {
  space: 'profile',
  recordType: 'user_preference',
});

console.log(memory.memory.spaces);
console.log(memory.build);
console.log(memory.contractIndex);
console.log(memory.contracts);
console.log(profileContract);
```

`loadMemory()` returns an inspectable Memory Blueprint object with:

- the installed memory manifest
- the installed package root path
- parsed `memory` metadata
- parsed `memory/build.json`
- parsed `memory/contracts/index.json`
- absolute paths for declared source schemas and indexed resolved contracts

It is a metadata and contract loader only. It does not provide live record CRUD, retention enforcement, trigger execution, or a hosted memory runtime.

`loadMemoryContract()` loads one indexed resolved contract on demand by `space` + `recordType`.

### Load an installed Profile package

```ts
import { loadProfile } from '@agentpm/sdk';

const profile = await loadProfile('@zack/support-style@0.1.0');

console.log(profile.profile.identity.role);
console.log(profile.profile.objectives);
console.log(profile.profile.communication);
```

`loadProfile()` returns an inspectable Instruction Profile object with:

- the installed profile manifest
- the installed package root path
- parsed authored `profile` metadata

### Load an installed Loop package

```ts
import { loadLoop } from '@agentpm/sdk';

const loop = await loadLoop('@zack/incident-response-loop@0.3.0');

console.log(loop.loop.entry_phase);
console.log(loop.loop.phases);
console.log(loop.loop.transitions);
console.log(loop.loop.error_policy);
```

`loadLoop()` returns an inspectable Loop object with:

- the installed loop manifest
- the installed package root path
- parsed authored `loop` metadata

### `load()` stays tool-only

```ts
import { load } from '@agentpm/sdk';

await load('@zack/triage-playbook@0.1.0');
// throws: use loadSkill("@zack/triage-playbook@0.1.0") instead

await load('@zack/python-docs@0.1.0');
// throws: use loadKnowledge("@zack/python-docs@0.1.0") instead

await load('@zack/profile-memory@0.1.0');
// throws: use loadMemory("@zack/profile-memory@0.1.0") instead

await load('@zack/support-style@0.1.0');
// throws: use loadProfile("@zack/support-style@0.1.0") instead

await load('@zack/incident-response-loop@0.3.0');
// throws: use loadLoop("@zack/incident-response-loop@0.3.0") instead
```

### CJS require

```js
const { load } = require('@agentpm/sdk');
```

---

## Where tools are discovered

Resolution order:

1. `AGENTPM_TOOL_DIR` (environment variable)
2. `./.agentpm/tools` (project-local)
3. `~/.agentpm/tools` (user-local)

Each tool lives in a directory like:

```
.agentpm/
  tools/
    @zack/summarize/
      0.1.0/
        agent.json
        (tool files…)
```

Installed registry agent packages live separately:

```
.agentpm/
  agents/
    @zack/support-agent/
      0.1.0/
        agent.json
        README.md
```

Installed registry skill packages live separately:

```
.agentpm/
  skills/
    @zack/triage-playbook/
      0.1.0/
        agent.json
        SKILL.md
```

Installed registry Knowledge packages live separately:

```
.agentpm/
  knowledge/
    @zack/python-docs/
      0.1.0/
        agent.json
        knowledge/
```

Installed registry Memory packages live separately:

```
.agentpm/
  memory/
    @zack/profile-memory/
      0.1.0/
        agent.json
        schemas/
        memory/
```

Installed registry Loop packages live separately:

```
.agentpm/
  loops/
    @zack/incident-response-loop/
      0.3.0/
        agent.json
```

## Where installed agents are discovered

Resolution order for `loadAgent()`:

1. `AGENTPM_AGENT_DIR` (environment variable)
2. `./.agentpm/agents` (project-local)
3. `~/.agentpm/agents` (user-local)

You can also override per call:

```ts
await loadAgent('@zack/support-agent@0.1.0', {
  agentDirOverride: '/path/to/agents',
});
```

## Where installed skills are discovered

Resolution order for `loadSkill()`:

1. `AGENTPM_SKILL_DIR` (environment variable)
2. `./.agentpm/skills` (project-local)
3. `~/.agentpm/skills` (user-local)

You can also override per call:

```ts
await loadSkill('@zack/triage-playbook@0.1.0', {
  skillDirOverride: '/path/to/skills',
});
```

## Where installed Knowledge packages are discovered

Resolution order for `loadKnowledge()`:

1. `AGENTPM_KNOWLEDGE_DIR` (environment variable)
2. `./.agentpm/knowledge` (project-local)
3. `~/.agentpm/knowledge` (user-local)

You can also override per call:

```ts
await loadKnowledge('@zack/python-docs@0.1.0', {
  knowledgeDirOverride: '/path/to/knowledge',
});
```

## Where installed Memory packages are discovered

Resolution order for `loadMemory()`:

1. `AGENTPM_MEMORY_DIR` (environment variable)
2. `./.agentpm/memory` (project-local)
3. `~/.agentpm/memory` (user-local)

You can also override per call:

```ts
await loadMemory('@zack/profile-memory@0.1.0', {
  memoryDirOverride: '/path/to/memory',
});
```

## Where installed Loop packages are discovered

Resolution order for `loadLoop()`:

1. `AGENTPM_LOOP_DIR` (environment variable)
2. `./.agentpm/loops` (project-local)
3. `~/.agentpm/loops` (user-local)

You can also override per call:

```ts
await loadLoop('@zack/incident-response-loop@0.3.0', {
  loopDirOverride: '/path/to/loops',
});
```

---

## Manifest & Runtime Contract

**`agent.json` (minimal fields used by the SDK):**

```json
{
  "name": "@zack/summarize",
  "version": "0.1.0",
  "description": "Summarize long text.",
  "inputs": {
    "type": "object",
    "properties": { "text": { "type": "string", "description": "Text to summarize" } },
    "required": ["text"]
  },
  "outputs": {
    "type": "object",
    "properties": { "summary": { "type": "string", "description": "Summarized text" } },
    "required": ["summary"]
  },
  "entrypoint": {
    "command": "node",
    "args": ["dist/cli.js"],
    "cwd": ".",
    "timeout_ms": 60000,
    "env": {}
  }
}
```

**Execution contract:**

- SDK writes **inputs JSON** to the process **stdin**.
- Tool writes a single **outputs JSON** object to **stdout**.
- Non-JSON logs should go to **stderr**.
- Process must exit with **code 0** on success.

**Interpreter whitelist:** `node`, `nodejs`, `python`, `python3`.
The CLI validates the interpreter at invocation and checks its runtime and installed environment.

---

## TypeScript & Module Formats

- ESM import: `import { load } from "@agentpm/sdk"` → loads `dist/index.js` (ESM).
- CJS require: `const { load } = require("@agentpm/sdk")` → loads `dist/index.cjs` (CJS).
- Types: `dist/index.d.ts`.

> If you see `ERR_MODULE_NOT_FOUND` for `index.mjs`, ensure your **package.json** maps the exports to `dist/index.js` (ESM) and `dist/index.cjs` (CJS).

---

## Development (this repo)

```bash
pnpm i

# build / test / lint / format
pnpm build
pnpm test
pnpm lint
pnpm format

# dev watch
pnpm dev
```

### Pre-commit hooks (Husky v9+)

```bash
pnpm dlx husky@latest init
printf 'pnpm lint-staged
' > .husky/pre-commit
chmod +x .husky/pre-commit
```

`package.json` essentials:

```jsonc
{
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
    },
  },
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "test": "vitest run",
    "lint": "eslint . --max-warnings 0",
    "format": "prettier --check .",
  },
}
```

### ESLint v9 (flat config)

Create `eslint.config.mjs`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
);
```

> Add `@types/node` in dev deps for TypeScript Node built-ins:
>
> ```bash
> pnpm add -D @types/node
> ```

---

## Optional: LangChain adapter

This SDK provides `toLangChainTool(loaded, ...)` which returns a dynamic tool. We keep `@langchain/core` as an **optional peer**. Install it only if you need the adapter:

```bash
pnpm add @langchain/core
```

In code:

```ts
import { load, toLangChainTool } from '@agentpm/sdk';

const loaded = await load('@zack/summarize@0.1.0', { withMeta: true });
const tool = await toLangChainTool(loaded);
```

---

## Publishing

```bash
# ensure your exports map and files list are correct
pnpm install
pnpm test && pnpm build
npm pack            # confirm the tarball contents
npm publish --dry-run  # double-check what would be published


# publish (scoped packages default to private without access flag)
pnpm publish --access public
```

Optional in `package.json`:

```json
"publishConfig": {
  "access": "public",
  "registry": "https://registry.npmjs.org/"
}
```

---

## Running mixed-runtime Agent apps with Docker

Some AgentPM tools run on Node, some on Python—and your agent may need to spawn both. Using Docker gives you a single, reproducible environment where both interpreters are installed and on PATH, which avoids the common “interpreter not found” issues that pop up on PaaS/CI or IDEs.

Why Docker?

✅ Both interpreters: Python and Node are available in the same image.

✅ No PATH drama: node/python are present and discoverable.

✅ Prod/CI parity: the same image runs on your laptop, CI, and servers.

✅ Easy secrets: pass API keys via env at docker run/Compose time.

✅ Fewer surprises: consistent OS libs for LLM clients, SSL, etc.

### When to use it

- You deploy to platforms that don’t let you apt-get both runtimes.
- Your agent uses tools with different interpreters (Node + Python).
- Your local dev/IDE PATH differs from production and causes failures.
- You want reproducible builds and easy rollback.

### How to use it

1. Copy the provided Dockerfile and `.dockerignore` from the [container scaffold](https://github.com/agentpm-dev/sdk-node/tree/main/examples/node-agent) into your repo.
2. Install a compatible Linux AgentPM CLI in the image and check `agentpm --version`.
   The linked Dockerfiles are app scaffolds; add the CLI executable for your
   supported Linux x86-64 glibc target to the build context as `agentpm`; the
   scaffold copies it onto PATH. The app dependency manifest must require SDK
   0.1.17+. Supply the app source/build output referenced by its final command.
3. Copy the authored manifest/portable `agent.lock`, then run `agentpm install`
   inside the image with its selected Python. Do not commit `.agentpm/` or copy
   host-managed environments into a different platform/container. For an app
   that loads an installed Agent without a local manifest, change the scaffold
   install command to `agentpm install @your-namespace/your-agent@1.0.0`. CLI 0.1.43 cannot
   replay direct non-Tool package references with `--frozen`; use the exact
   Agent reference and review the resulting lock rather than editing it.
4. Build & run:

```bash
docker build --platform linux/amd64 -t agent-app .
docker run --rm --platform linux/amd64 -e OPENAI_API_KEY agent-app
```

The released Linux CLI 0.1.43 needs glibc 2.39 or newer. These scaffolds use
matching Debian Trixie bases and target Linux x86-64; a different Docker host
needs its own container emulation support. This does not add a native Linux
arm64 or musl CLI release.

Running amd64 images on Apple Silicon depends on Docker's emulator. Container
verification encountered a TLS error under Rosetta and a verified uv 0.13.5
startup crash under QEMU; both SDK container checks passed on native Linux
x86-64. Use a native Linux build runner when emulation blocks installation.
See [container emulation troubleshooting](https://www.agentpackagemanager.com/docs/v0.1/advanced/mixed-runtimes-with-docker#apple-silicon-and-amd64-emulation).

5. For development, use the docker-compose.yml snippet to mount your source and pass env vars conveniently.

### Troubleshooting

- Set `AGENTPM_DEBUG=1` to print the SDK’s project root and package search paths. Environment values are not logged.
- You can force interpreters via:

```ini
AGENTPM_NODE=/usr/bin/node
AGENTPM_PYTHON=/usr/local/bin/python3.13
```

- Use portable `node`/`python` entrypoint commands. Select host-specific executables with the CLI interpreter overrides; the CLI owns managed Python selection.

---

## Troubleshooting

- **ERR_MODULE_NOT_FOUND for ESM**
  Your `package.json` likely points to `dist/index.mjs` but your build emits `dist/index.js`. Fix the `exports` map or configure tsup to output `.mjs`.

- **Husky "add is DEPRECATED"**
  In v9+, use `husky init` and write hook files directly (see above).

- **ESLint can't find config**
  ESLint v9 uses **flat config**. Create `eslint.config.mjs` as shown.

- **Types for `@langchain/core`**
  Keep `@langchain/core` as a peer (optional). For build-time types in this repo, install it as a devDependency and mark it `external` in `tsup.config.ts`.

---

## License

MIT — see `LICENSE`.

## Releases, locks and migration

SDK **0.1.17+** reads supported v2/v3/v4 locks and delegates all Python and Node
Tool calls to CLI **0.1.43+**. Older SDKs are not made compatible by upgrading
only the CLI. An unsupported future lock version fails instead of being
rewritten. Keep portable `agent.lock` in source control and local `.agentpm/`
install/runtime state out of it.

For new Python releases, lock integrity identifies the logical release, which
binds every target artifact. CLI install chooses the exact consumer target
before an `any` fallback and verifies provenance, archive bytes and locked Python
wheels. Source-only Tools can use `any` even with native dependencies. Legacy
Python/Node Tools keep their release semantics while using the same CLI bridge.

Use `agentpm install` to update AgentPM package references/install state and
`agentpm install --refresh` for damaged packages. Use the language package manager
to upgrade this SDK. SDK calls do not install, rebuild or repair environments.
Containers and CI jobs need the compatible CLI in addition to this package.

See the public [Python dependency and migration guide](https://www.agentpackagemanager.com/docs/v0.1/advanced/python-dependencies),
[release integrity](https://www.agentpackagemanager.com/docs/v0.1/advanced/release-integrity),
[environment settings](https://www.agentpackagemanager.com/docs/v0.1/advanced/environment-variables)
and [maintained examples](https://github.com/agentpm-dev/agentpm-examples).
Minimal anonymous CLI telemetry is enabled by default; set `AGENTPM_TELEMETRY=0`
for opt-out. See [privacy and feedback](https://www.agentpackagemanager.com/docs/v0.1/advanced/analytics-and-feedback).

## Contributor verification

Build CLI 0.1.43+ from the matching CLI revision, then set `AGENTPM` and
`AGENTPM_TEST_CLI` to that executable. Set `AGENTPM_TEST_UV` to the verified
pinned uv 0.13.5 binary and `AGENTPM_TEST_PYTHON` to a Python 3.11+ executable
to include the no-model native dependency test. The local Registry fixture
serves test archives only; uv verifies the checked-in pydantic resolution's
wheels. No publication or real Registry credentials are needed. Without these
test variables the explicitly marked native integration is skipped.

CI runs the suites and native integration on Linux x64, both macOS architectures
and Windows x64. It compares the byte-identical `fixtures/sdk-v1` snapshots with
`agentpm-dev/cli`'s `crates/agentpm-sdk/contracts/sdk-v1`. Before CLI main contains the compatible
bridge, dispatch CI with `cli_ref` or set repository variable `AGENTPM_CLI_REF`
to the proposed CLI ref. Release workflows always use CLI main; merge the CLI
prerequisite before publishing SDK tags. Hosted passes and published-package
consumer smokes are separate from local source/build checks.
