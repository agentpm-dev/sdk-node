# AgentPM Node SDK

A lean, framework-agnostic **Node.js SDK** for running **AgentPM** tools from your app or agent runtime.

- 🔎 **Discovers** tools installed by `agentpm install` in `.agentpm/tools` (project) and `~/.agentpm/tools` (user), with `AGENTPM_TOOL_DIR` override.
- 🚀 **Executes entrypoints** in a subprocess (`node`/`python`) and exchanges JSON over stdin/stdout.
- 🧩 **Metadata-aware**: `withMeta` returns `func + meta` (name, version, description, inputs, outputs).
- 🧪 **Adapters**: tiny helpers (e.g. LangChain) without forcing extra deps.

> Requires **Node 20+**. Ships ESM + CJS builds. Types included.

---

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
The SDK validates the interpreter and checks it’s present on `PATH`.

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

✅ Hermetic: Python + Node versions are pinned inside the image.

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

1. Copy the provided [Dockerfile](https://github.com/agentpm-dev/sdk-node/tree/main/examples/node-agent) into your repo.
2. (Optional) Pre-install tools locally with agentpm install ... and commit or copy .agentpm/tools/ into the image, or run agentpm install at build time if your CLI is available in the image.
3. Build & run:

```bash
docker build -t agent-app .
docker run --rm -e OPENAI_API_KEY=$OPENAI_API_KEY agent-app
```

4. For development, use the docker-compose.yml snippet to mount your source and pass env vars conveniently.

### Troubleshooting

- Set `AGENTPM_DEBUG=1` to print the SDK’s project root, search paths, merged PATH, and resolved interpreters.
- You can force interpreters via:

```ini
AGENTPM_NODE=/usr/bin/node
AGENTPM_PYTHON=/usr/local/bin/python3.11
```

- Prefer absolute interpreters in agent.json.entrypoint.command for production (e.g., /usr/bin/node). The SDKs still enforce the Node/Python family.

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
