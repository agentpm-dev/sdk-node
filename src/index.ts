import { spawn, spawnSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  readdirSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import fs from 'node:fs';
import path from 'node:path';

import semver from 'semver';

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

function debugEnabled(): boolean {
  const v = process.env.AGENTPM_DEBUG || '';
  return v !== '' && !['0', 'false', 'no'].includes(v.toLowerCase());
}

function dprint(...args: unknown[]) {
  if (debugEnabled()) console.error('[agentpm-debug]', ...args);
}

function abbrev(s: string, n = 240) {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function mergeEnv(
  entryEnv?: Record<string, string>,
  callerEnv?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  // copy only defined vars from process.env
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') merged[k] = v;
  }
  if (entryEnv) Object.assign(merged, entryEnv);
  if (callerEnv) Object.assign(merged, callerEnv);
  return merged;
}

// Minimal cross-platform PATH resolver (no external deps)
function resolveOnPath(cmd: string, envPath: string): string | null {
  const sepList = envPath ? envPath.split(path.delimiter) : [];
  const hasDir = cmd.includes('/') || cmd.includes('\\');
  const pathext =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
      : [''];

  const tryFile = (full: string) => {
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  // If cmd has a slash, check it directly (and PATHEXT on Windows)
  if (hasDir) {
    for (const ext of pathext) {
      const full = process.platform === 'win32' ? fullWithExt(cmd, ext) : cmd;
      if (tryFile(full)) return full;
    }
    return null;
  }

  // Search each dir on PATH
  for (const dir of sepList) {
    if (!dir) continue;

    // exact name first
    const base = path.join(dir, cmd);
    if (tryFile(base)) return base;

    // try PATHEXT on Windows
    if (process.platform === 'win32') {
      for (const ext of pathext) {
        const full = fullWithExt(base, ext);
        if (tryFile(full)) return full;
      }
    }
  }
  return null;

  function fullWithExt(p: string, ext: string) {
    // ext already includes dot
    return p.endsWith(ext) ? p : p + ext.toLowerCase();
  }
}

function canonicalInterpreter(cmd: string): string {
  const base = basename(cmd).toLowerCase();
  return base.replace(/\.(exe|cmd|bat)$/i, '');
}

const BARE_NODE = /^(node|nodejs)$/i;
const BARE_PY = /^python(3(\.\d+)*)?$/i;

function interpreterFamily(cmd: string): 'node' | 'python' | null {
  const base = path
    .basename(cmd)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat)$/i, '');
  if (BARE_NODE.test(base)) return 'node';
  if (BARE_PY.test(base)) return 'python';
  return null; // absolute paths still get matched by basename
}

function resolveInterpreterCommand(
  cmd: string,
  entryEnv?: Record<string, string>,
  callerEnv?: Record<string, string>,
  runtimeType?: string, // optional hint
): string {
  const merged = mergeEnv(entryEnv, callerEnv);

  // Prefer inferring from the command; fall back to runtime hint if needed
  const inferred = interpreterFamily(cmd);
  const hint = runtimeType === 'node' || runtimeType === 'python' ? runtimeType : undefined;
  const family: 'node' | 'python' | null = inferred ?? hint ?? null;

  let resolved = cmd;
  if (family === 'node' && merged.AGENTPM_NODE) {
    dprint(`override interpreter (node): "${cmd}" -> "${merged.AGENTPM_NODE}"`);
    resolved = merged.AGENTPM_NODE;
  } else if (family === 'python' && merged.AGENTPM_PYTHON) {
    dprint(`override interpreter (python): "${cmd}" -> "${merged.AGENTPM_PYTHON}"`);
    resolved = merged.AGENTPM_PYTHON;
  }
  return resolved;
}

function assertAllowedInterpreter(cmd: string) {
  const canon = canonicalInterpreter(cmd);
  if (
    !ALLOWED_INTERPRETERS.has(canon) &&
    !canon.startsWith('python3') // e.g. python3.11
  ) {
    throw new Error(
      `Unsupported agent.json.entrypoint.command "${cmd}". Allowed: node|nodejs|python|python3`,
    );
  }
}

// verify the interpreter exists on PATH
function assertInterpreterAvailable(
  cmd: string,
  entryEnv?: Record<string, string>,
  callerEnv?: Record<string, string>,
) {
  const merged = mergeEnv(entryEnv, callerEnv);

  const envPath = merged.PATH ?? '';
  const found = resolveOnPath(cmd, envPath);
  dprint(`interpreter="${cmd}" which=${found || '<not found>'}`);
  dprint(`MERGED PATH=${abbrev(envPath)}`);

  if (!found) {
    // As an extra signal, try a quick --version with the merged env (covers aliases/wrappers)
    const res = spawnSync(cmd, ['--version'], { stdio: 'ignore', env: merged });
    const enoent =
      (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') || !res.pid;
    if (enoent) {
      throw new Error(`Interpreter "${cmd}" not found on PATH.\nChecked PATH=${merged.PATH}`);
    }
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

function listInstalledVersions(base: string, name: string): string[] {
  const seen = new Set<string>();
  for (const nameDir of candidateNameDirs(base, name)) {
    if (!(existsSync(nameDir) && statSync(nameDir).isDirectory())) continue;
    for (const v of readdirSync(nameDir)) {
      if (!semver.valid(v)) continue;
      if (existsSync(join(nameDir, v, 'agent.json'))) seen.add(v);
    }
  }
  return Array.from(seen);
}

function candidateNameDirs(base: string, name: string): string[] {
  // Supports: "@scope/name" OR "scope/name"
  // Tries: base/@scope/name, base/scope/name, base/scope__name, base/scope-name
  const parts = name.split('/');

  if (parts.length === 2) {
    // Scoped: either "@scope/pkg" or "scope/pkg"
    const rawScope = parts[0]!;
    const pkg = parts[1]!;
    const scope = rawScope.replace(/^@/, '');

    return [
      join(base, `@${scope}`, pkg), // with '@'
      join(base, scope, pkg), // without '@'
      join(base, `${scope}__${pkg}`),
      join(base, `${scope}-${pkg}`),
    ];
  }

  // Unscoped package
  return [join(base, name)];
}

function findInstalled(
  base: string,
  name: string,
  version: string,
): { root: string; manifestPath: string } | null {
  // exact match
  for (const nameDir of candidateNameDirs(base, name)) {
    const nested = join(nameDir, version);
    const manifest = join(nested, 'agent.json');
    if (existsSync(manifest)) {
      return { root: nested, manifestPath: manifest };
    }
  }
  return null;
}

function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, 'agent.json'))) return dir;
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (existsSync(join(dir, 'turbo.json'))) return dir;
    if (existsSync(join(dir, 'lerna.json'))) return dir;
    if (existsSync(join(dir, '.git'))) return dir;

    const parent = dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }
  return resolve(startDir);
}

function resolveToolRoot(spec: string, toolDirOverride?: string) {
  // spec form: @scope/name@<version or range or 'latest'>
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Invalid tool spec "${spec}". Expected "@scope/name@version".`);
  }
  const rangeOrVersion = spec.slice(atIdx + 1).trim();
  const name = spec.slice(1, atIdx);
  const projectRoot = findProjectRoot(process.cwd());

  dprint(`project_root=${projectRoot}`);

  const candidates = [
    toolDirOverride,
    process.env.AGENTPM_TOOL_DIR, // optional override
    resolve(projectRoot, '.agentpm/tools'), // project-local (preferred)
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/tools') : undefined, // fallback
  ].filter(Boolean) as string[];

  dprint('candidates:\n  ' + candidates.map((c) => String(c)).join('\n  '));

  // 1) Exact version fast-path
  if (semver.valid(rangeOrVersion)) {
    for (const base of candidates) {
      const hit = findInstalled(base, name, rangeOrVersion);
      if (hit) return hit;
    }
    throw new Error(`Tool "${spec}" not found in .agentpm/tools (or overrides).`);
  }

  // 2) "latest" or a semver range
  const isLatest = rangeOrVersion.toLowerCase() === 'latest';
  const isRange = semver.validRange(rangeOrVersion) !== null;

  if (!isLatest && !isRange) {
    throw new Error(
      `Invalid version/range "${rangeOrVersion}". Use exact (e.g. 0.1.2), a semver range (e.g. ^0.1), or "latest".`,
    );
  }

  for (const base of candidates) {
    const installed = listInstalledVersions(base, name);
    if (installed.length === 0) continue;

    const picked = isLatest
      ? semver.rsort(installed)[0]!
      : semver.maxSatisfying(installed, rangeOrVersion, { includePrerelease: false });

    if (!picked) continue;

    const hit = findInstalled(base, name, picked);
    if (hit) return hit;
  }

  const searched = candidates.join(', ');
  throw new Error(
    `No installed version of "${name}" matches "${rangeOrVersion}". Searched: ${searched}`,
  );
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
  if (
    canonicalInterpreter(entry.command).startsWith('node') &&
    !cmd.some((a) => a.startsWith('--max-old-space-size'))
  ) {
    cmd.splice(1, 0, '--max-old-space-size=256');
  }
  // NOTE: For python isolated mode, we can’t inject flags reliably from Node; rely on Python SDK for that case.

  dprint(`launch: argv=${cmd}`);
  dprint(`cwd=${cwd}`);
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

// Overloads:
export async function load(
  spec: string,
  options?: Omit<LoadOptions, 'withMeta'> & { withMeta?: false },
): Promise<(input: JsonValue) => Promise<JsonValue>>;

export async function load(
  spec: string,
  options: Omit<LoadOptions, 'withMeta'> & { withMeta: true },
): Promise<{ func: (input: JsonValue) => Promise<JsonValue>; meta: ToolMeta }>;

export async function load(spec: string, options: LoadOptions = {}): Promise<Loaded> {
  dprint(`spec=${spec}`);

  const { root, manifestPath } = resolveToolRoot(spec, options.toolDirOverride);
  const manifest = readManifest(manifestPath);

  const ep = manifest.entrypoint;
  dprint(`resolved root=${root}`);
  dprint(`manifest=${manifestPath}`);
  dprint(`entry.command="${ep['command']}" args=${ep.args ?? []}`);

  const env = ep.env ?? {};

  const resolvedCmd = resolveInterpreterCommand(
    ep.command,
    env,
    options.env,
    manifest.runtime?.type,
  );

  // enforce interpreter whitelist and available
  assertAllowedInterpreter(resolvedCmd);
  assertInterpreterAvailable(resolvedCmd, env, options.env ?? {});

  // enforce interpreter and runtime compatability
  if (manifest.runtime) {
    assertInterpreterMatchesRuntime(resolvedCmd, manifest.runtime);
  }

  const timeoutMs = options.timeoutMs ?? manifest.entrypoint?.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  // pass the resolved command to the spawner by shadowing the entry
  const entryForSpawn = { ...manifest.entrypoint, command: resolvedCmd };

  const func = async (input: JsonValue) =>
    spawnOnce(root, entryForSpawn, input, { timeoutMs, env: options.env });

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
