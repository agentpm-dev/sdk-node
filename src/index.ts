import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export type JsonPrimitive = string | number | boolean | null;

// Recursive JSON value
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];

export type ToolMeta = {
  name: string;
  version: string;
  description?: string;
  inputs?: JsonValue;
  outputs?: JsonValue;
  runtime?: Runtime;
};

type Runtime = {
  type: string;
  version: string;
};

type Entrypoint = {
  command: string; // e.g. "node" | "python"
  args?: string[]; // e.g. ["dist/cli.js"]
  cwd?: string; // relative to the tool dir
  timeout_ms?: number; // default set in SDK
  env?: Record<string, string>;
};

type Manifest = ToolMeta & {
  entrypoint: Entrypoint;
};

export type LoadOptions = {
  withMeta?: boolean;
  // optional overrides
  timeoutMs?: number; // hard cap per-invoke
  toolDirOverride?: string; // for tests/custom layouts
  env?: Record<string, string>; // merged into process env
};

type Loaded =
  | ((input: JsonValue) => Promise<JsonValue>)
  | { func: (input: JsonValue) => Promise<JsonValue>; meta: ToolMeta };

const DEFAULT_TIMEOUT_MS = 120_000; // 2m
const ALLOWED_INTERPRETERS = new Set(['node', 'nodejs', 'python', 'python3']);

function canonicalInterpreter(cmd: string): string {
  // handle absolute paths and Windows extensions
  const base = basename(cmd).toLowerCase();
  return base.replace(/\.(exe|cmd|bat)$/i, '');
}

function assertAllowedInterpreter(cmd: string) {
  const canon = canonicalInterpreter(cmd);
  if (!ALLOWED_INTERPRETERS.has(canon)) {
    throw new Error(
      `Unsupported agent.json.entrypoint.command "${cmd}". Allowed: node|nodejs|python|python3`,
    );
  }
}

// verify the interpreter exists on PATH
function assertInterpreterAvailable(cmd: string) {
  const res = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  const err = res.error;

  if (err && isErrnoException(err) && err.code === 'ENOENT') {
    throw new Error(`Interpreter "${cmd}" not found on PATH. Install it to load tool.`);
  }
}

function assertInterpreterMatchesRuntime(cmd: string, runtime: Runtime) {
  const canon = canonicalInterpreter(cmd);
  const runtimeInterpreter = canonicalInterpreter(runtime.type);

  if (!isInterpreterMatch(runtimeInterpreter, canon)) {
    throw new Error(
      `Misconfigured tool - agent.json.entrypoint.command "${cmd}" does not match tool runtime "${runtimeInterpreter}".`,
    );
  }
}

const ALIASES = new Map<string, ReadonlyArray<string>>([
  ['python', ['python3']],
  ['node', ['nodejs']],
]);

export function isInterpreterMatch(runtime: string, command: string): boolean {
  const r = runtime.toLowerCase();
  const c = command.toLowerCase();

  if (r === c) return true;

  const cmds = ALIASES.get(r);
  return !!cmds && cmds.includes(c);
}

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && typeof (e as { code?: unknown }).code !== 'undefined';
}

function resolveToolRoot(spec: string, toolDirOverride?: string) {
  // spec form: "@scope/name@1.2.3"
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Invalid tool spec "${spec}". Expected "@scope/name@version".`);
  }
  const version = spec.slice(atIdx + 1);
  const name = spec.slice(0, atIdx);

  const candidates = [
    toolDirOverride,
    process.env.AGENTPM_TOOL_DIR, // optional override
    resolve(process.cwd(), '.agentpm/tools'), // project-local (preferred)
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/tools') : undefined, // fallback
  ].filter(Boolean) as string[];

  for (const base of candidates) {
    const root = join(base, `${name}/${version}`);
    const manifestPath = join(root, 'agent.json');
    if (existsSync(manifestPath)) return { root, manifestPath };
  }
  throw new Error(`Tool "${spec}" not found in .agentpm/tools (or overrides).`);
}

function readManifest(path: string): Manifest {
  const raw = readFileSync(path, 'utf-8');
  const m = JSON.parse(raw);
  if (!m?.entrypoint?.command) {
    throw new Error(`agent.json missing entrypoint.command at: ${path}`);
  }
  return m;
}

function buildEnv(
  entryEnv: Record<string, string> = {},
  callerEnv: Record<string, string> = {},
  home: string,
  tmpdir: string,
) {
  const base: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: home,
    TMPDIR: tmpdir,
  };
  if (process.env.LANG) base.LANG = process.env.LANG;
  return { ...base, ...entryEnv, ...callerEnv };
}

function spawnOnce(
  root: string,
  entry: Entrypoint,
  payload: JsonValue,
  opts: { timeoutMs: number; env?: Record<string, string> },
): Promise<JsonValue> {
  // 1) Tool working dir (what the tool expects for relative paths)
  const cwd = resolve(root, entry.cwd ?? '.');

  // 2) Isolated run dirs for HOME/TMPDIR
  const runRoot = join(entry.cwd ?? '.', 'run');
  mkdirSync(runRoot, { recursive: true });
  const work = mkdtempSync(join(runRoot, 'run-'));
  const home = join(work, 'home');
  mkdirSync(home, { recursive: true });
  const tmpd = join(work, 'tmp');
  mkdirSync(tmpd, { recursive: true });

  // 3) Command + hardening flags
  const cmd = [entry.command, ...(entry.args ?? [])];
  if (entry.command.startsWith('node') && !cmd.some((a) => a.startsWith('--max-old-space-size'))) {
    cmd.splice(1, 0, '--max-old-space-size=256');
  }
  // NOTE: For python isolated mode, we can’t inject flags reliably from Node; rely on Python SDK for that case.

  // 4) Clean env, 5) Spawn
  const child = spawn(entry.command, cmd.slice(1), {
    cwd,
    env: buildEnv(entry.env ?? {}, opts.env, home, tmpd),
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true, // new process group on POSIX
    windowsHide: true,
  });

  return new Promise((resolveP, rejectP) => {
    const limit = 10 * 1024 * 1024;
    let out = '',
      err = '';
    const killTree = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        /* empty */
      }
      try {
        child.kill('SIGKILL');
      } catch {
        /* empty */
      }
    };
    const t = setTimeout(() => {
      killTree();
      rejectP(new Error(`Tool timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    child.stdout!.on('data', (c: Buffer | string) => {
      out += c.toString();
      if (Buffer.byteLength(out) + Buffer.byteLength(err) > limit) {
        killTree();
        clearTimeout(t);
        rejectP(new Error('Tool produced too much output; limit is 10MB'));
      }
    });

    child.stderr!.on('data', (c: Buffer | string) => {
      err += c.toString();
      if (Buffer.byteLength(out) + Buffer.byteLength(err) > limit) {
        killTree();
        clearTimeout(t);
        rejectP(new Error('Tool produced too much output; limit is 10MB'));
      }
    });

    child.on('error', (e) => {
      clearTimeout(t);
      rmSync(work, { recursive: true, force: true });
      rejectP(e);
    });

    child.on('close', (code) => {
      clearTimeout(t);
      rmSync(work, { recursive: true, force: true });
      if (code !== 0) {
        const tail = err.slice(-4000);
        rejectP(new Error(`Tool exited with code ${code}. Stderr (tail):\n${tail}`));
        return;
      }
      try {
        // Allow tools to print non-JSON noise before/after; grab last JSON object.
        const lastJson = extractLastJsonObject(out);
        resolveP(lastJson);
      } catch {
        const tail = err.slice(-4000);
        rejectP(
          new Error(
            `Failed to parse tool JSON output.\nStderr:\n${tail}\nStdout (tail):\n${out.slice(-4000)}`,
          ),
        );
      }
    });

    child.stdin!.end(JSON.stringify(payload));
  });
}

function extractLastJsonObject(txt: string): JsonValue {
  // naive but effective: scan for last '{' and try JSON.parse from there.
  const idx = txt.lastIndexOf('{');
  if (idx < 0) throw new Error('No JSON object found on stdout.');
  const slice = txt.slice(idx);
  return JSON.parse(slice) as JsonValue;
}

export async function load(spec: string, options: LoadOptions = {}): Promise<Loaded> {
  const { root, manifestPath } = resolveToolRoot(spec, options.toolDirOverride);
  const manifest = readManifest(manifestPath);

  // enforce interpreter whitelist and available
  assertAllowedInterpreter(manifest.entrypoint.command);
  assertInterpreterAvailable(manifest.entrypoint.command);

  // enforce interpreter and runtime compatability
  if (manifest.runtime) {
    assertInterpreterMatchesRuntime(manifest.entrypoint.command, manifest.runtime);
  }

  const timeoutMs = options.timeoutMs ?? manifest.entrypoint?.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  const func = async (input: JsonValue) =>
    spawnOnce(root, manifest.entrypoint, input, { timeoutMs, env: options.env });

  if (options.withMeta) {
    const meta: ToolMeta = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      inputs: manifest.inputs,
      outputs: manifest.outputs,
    };
    return { func, meta };
  }
  return func;
}
