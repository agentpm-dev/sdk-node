import { spawn, spawnSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import fs from 'node:fs';
import path from 'node:path';
import { platform } from 'node:os';

import semver from 'semver';

export type JsonPrimitive = string | number | boolean | null;

// Recursive JSON value
export type JsonValue = JsonPrimitive | { [key: string]: JsonValue } | JsonValue[];

export type DependencyReference =
  | string
  | {
      name: string;
      version?: string;
    };

export type ToolMeta = {
  name: string;
  version: string;
  description?: string;
  inputs?: JsonValue;
  outputs?: JsonValue;
  runtime?: Runtime;
  environment?: Environment;
};

export type AgentMeta = {
  kind: 'agent';
  name: string;
  version: string;
  description?: string;
  tools?: DependencyReference[];
  examples?: JsonValue[];
  skills?: DependencyReference[];
  knowledge?: DependencyReference[];
  memory?: DependencyReference[];
  profiles?: DependencyReference[];
};

export type SkillCompatibility = {
  model_families?: string[];
  runtimes?: string[];
  environments?: string[];
  export_targets?: string[];
};

export type SkillMetadata = {
  entrypoint: string;
  references?: string[];
  scripts?: string[];
  compatibility?: SkillCompatibility;
};

export type SkillMeta = {
  kind: 'skill';
  name: string;
  version: string;
  description?: string;
  tools?: DependencyReference[];
  skill: SkillMetadata;
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

type EnvVar = {
  required: boolean;
  description: string;
  default?: string;
};
type Environment = { vars?: Record<string, EnvVar> };

type Manifest = ToolMeta & {
  entrypoint: Entrypoint;
  environment?: Environment;
};

type AgentManifest = AgentMeta;
type SkillManifest = SkillMeta;

export type LoadOptions = {
  withMeta?: boolean;
  // optional overrides
  timeoutMs?: number; // hard cap per-invoke
  toolDirOverride?: string; // for tests/custom layouts
  env?: Record<string, string>; // merged into process env
};

export type LoadAgentOptions = {
  agentDirOverride?: string;
  skillDirOverride?: string;
  toolDirOverride?: string;
  lockfileOverride?: string;
};

export type LoadSkillOptions = {
  skillDirOverride?: string;
  toolDirOverride?: string;
  lockfileOverride?: string;
};

type Loaded =
  | ((input: JsonValue) => Promise<JsonValue>)
  | { func: (input: JsonValue) => Promise<JsonValue>; meta: ToolMeta };

export type ResolvedAgentToolRef = {
  packageKey: string;
  kind: 'tool';
  name: string;
  version: string;
  integrity: string;
  root: string | null;
  manifestPath: string | null;
};

export type ResolvedAgentSkillRef = {
  packageKey: string;
  kind: 'skill';
  name: string;
  version: string;
  integrity: string;
  root: string | null;
  manifestPath: string | null;
};

export type ReservedReferences = {
  knowledge: DependencyReference[];
  memory: DependencyReference[];
  profiles: DependencyReference[];
};

export type LoadedAgent = {
  root: string;
  manifestPath: string;
  manifest: AgentManifest;
  resolvedTools: ResolvedAgentToolRef[];
  resolvedSkills: ResolvedAgentSkillRef[];
  reserved: ReservedReferences;
};

export type LoadedSkill = {
  kind: 'skill';
  name: string;
  version: string;
  description?: string;
  root: string;
  manifestPath: string;
  manifest: SkillManifest;
  skill: SkillMetadata;
  entrypointPath: string;
  entrypointContent: string;
  references: string[];
  scripts: string[];
  resolvedTools: ResolvedAgentToolRef[];
};

type LockedPackage = {
  kind: string;
  name: string;
  version: string;
  integrity: string;
};

type LockedRoot = {
  name?: string;
  version?: string;
  tools?: string[];
  skills?: string[];
  reserved?: Partial<ReservedReferences>;
};

type LockfileV2 = {
  lockfile_version: number;
  packages?: Record<string, LockedPackage>;
  roots?: Record<string, LockedRoot>;
};

const MAX_BYTES = 10 * 1024 * 1024;
const GRACE_AFTER_JSON = 400; // ms
const KILL_AFTER_TERM = 150; // ms

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
  const name = spec.slice(0, atIdx);
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

function resolveAgentRoot(spec: string, agentDirOverride?: string) {
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Invalid agent spec "${spec}". Expected "@scope/name@version".`);
  }
  const rangeOrVersion = spec.slice(atIdx + 1).trim();
  const name = spec.slice(0, atIdx);
  const projectRoot = findProjectRoot(process.cwd());

  const candidates = [
    agentDirOverride,
    process.env.AGENTPM_AGENT_DIR,
    resolve(projectRoot, '.agentpm/agents'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/agents') : undefined,
  ].filter(Boolean) as string[];

  if (semver.valid(rangeOrVersion)) {
    for (const base of candidates) {
      const hit = findInstalled(base, name, rangeOrVersion);
      if (hit) return { ...hit, packageName: name };
    }
    throw new Error(`Agent "${spec}" not found in .agentpm/agents (or overrides).`);
  }

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
    if (hit) return { ...hit, packageName: name };
  }

  const searched = candidates.join(', ');
  throw new Error(
    `No installed version of "${name}" matches "${rangeOrVersion}". Searched: ${searched}`,
  );
}

function resolveSkillRoot(spec: string, skillDirOverride?: string) {
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Invalid skill spec "${spec}". Expected "@scope/name@version".`);
  }
  const rangeOrVersion = spec.slice(atIdx + 1).trim();
  const name = spec.slice(0, atIdx);
  const projectRoot = findProjectRoot(process.cwd());

  const candidates = [
    skillDirOverride,
    process.env.AGENTPM_SKILL_DIR,
    resolve(projectRoot, '.agentpm/skills'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/skills') : undefined,
  ].filter(Boolean) as string[];

  if (semver.valid(rangeOrVersion)) {
    for (const base of candidates) {
      const hit = findInstalled(base, name, rangeOrVersion);
      if (hit) return { ...hit, packageName: name };
    }
    throw new Error(`Skill "${spec}" not found in .agentpm/skills (or overrides).`);
  }

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
    if (hit) return { ...hit, packageName: name };
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

function readAgentManifest(path: string): AgentManifest {
  const raw = readFileSync(path, 'utf-8');
  const manifest = JSON.parse(raw) as AgentManifest;
  if (manifest?.kind !== 'agent') {
    throw new Error(`agent.json is not an agent manifest at: ${path}`);
  }
  return manifest;
}

function readSkillManifest(path: string): SkillManifest {
  const raw = readFileSync(path, 'utf-8');
  const manifest = JSON.parse(raw) as SkillManifest;
  if (manifest?.kind !== 'skill') {
    throw new Error(`agent.json is not a skill manifest at: ${path}`);
  }
  if (!manifest.skill?.entrypoint) {
    throw new Error(`agent.json missing skill.entrypoint at: ${path}`);
  }
  return manifest;
}

// Historical name: this helper now accepts modern agent.lock shapes v2 and v3.
// Keep the narrower name for now to avoid internal churn while Skills remain the
// only v3-specific addition on top of the same overall lock envelope.
function readLockfileV2(lockfilePath: string): LockfileV2 {
  const raw = readFileSync(lockfilePath, 'utf-8');
  const lock = JSON.parse(raw) as LockfileV2;
  if (lock.lockfile_version !== 2 && lock.lockfile_version !== 3) {
    throw new Error(
      `Unsupported lockfile version at ${lockfilePath}; expected agent.lock v2 or v3. Run "agentpm install" to regenerate the lockfile.`,
    );
  }
  return lock;
}

function resolveAgentLockfilePath(lockfileOverride?: string): string {
  if (lockfileOverride) return lockfileOverride;
  return join(findProjectRoot(process.cwd()), 'agent.lock');
}

function resolveToolInstalledPath(
  name: string,
  version: string,
  toolDirOverride?: string,
): { root: string; manifestPath: string } | null {
  const projectRoot = findProjectRoot(process.cwd());
  const candidates = [
    toolDirOverride,
    process.env.AGENTPM_TOOL_DIR,
    resolve(projectRoot, '.agentpm/tools'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/tools') : undefined,
  ].filter(Boolean) as string[];

  for (const base of candidates) {
    const hit = findInstalled(base, name, version);
    if (hit) return hit;
  }
  return null;
}

function resolveSkillInstalledPath(
  name: string,
  version: string,
  skillDirOverride?: string,
): { root: string; manifestPath: string } | null {
  const projectRoot = findProjectRoot(process.cwd());
  const candidates = [
    skillDirOverride,
    process.env.AGENTPM_SKILL_DIR,
    resolve(projectRoot, '.agentpm/skills'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/skills') : undefined,
  ].filter(Boolean) as string[];

  for (const base of candidates) {
    const hit = findInstalled(base, name, version);
    if (hit) return hit;
  }
  return null;
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

function isPythonCmd(cmd0: string) {
  const base = path.basename(cmd0).toLowerCase();
  return base === 'py' || base.startsWith('python');
}

function ensureUnbufferedPython(cmd: string[], env: Record<string, string | undefined>) {
  if (cmd.length === 0) return { cmd: [], env };

  // Non-null assert + concrete types
  const interp: string = cmd[0]!;
  const rest: string[] = cmd.slice(1) as string[];

  if (!isPythonCmd(interp)) {
    return { cmd: [interp, ...rest], env };
  }

  const hasDashU = rest.includes('-u');
  const nextEnv: NodeJS.ProcessEnv = { ...env, PYTHONUNBUFFERED: env.PYTHONUNBUFFERED ?? '1' };
  const newCmd: string[] = hasDashU ? [interp, ...rest] : [interp, '-u', ...rest];
  return { cmd: newCmd, env: nextEnv };
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

  const isWin = platform() === 'win32';

  // 3) Command + hardening flags
  const { cmd, env } = ensureUnbufferedPython(
    [entry.command, ...(entry.args ?? [])],
    buildEnv(entry.env ?? {}, opts.env, home, tmpd),
  );
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
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: !isWin, // new process group on POSIX
    windowsHide: true,
  });

  return new Promise((resolveP, rejectP) => {
    let totalBytes = 0;
    let out = ''; // full stdout (for diagnostics)
    let err = '';
    let parsed: unknown | null = null;
    let sentTERM = false;
    let sentKILL = false;

    // --- Timers ---
    const timeout = setTimeout(() => {
      killTree(child, true);
      rejectOnce(new Error(`Tool timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);

    let graceTimer: NodeJS.Timeout | null = null;
    function startGrace() {
      if (graceTimer) return;
      graceTimer = setTimeout(() => {
        if (child.exitCode == null) {
          killTree(child, false);
          sentTERM = true;
          setTimeout(() => {
            if (child.exitCode == null) {
              killTree(child, true);
              sentKILL = true;
            }
          }, KILL_AFTER_TERM);
        }
      }, GRACE_AFTER_JSON);
    }

    const incr = extractFirstJsonIncremental();

    const rejectOnce = (e: Error) => {
      clearTimeout(timeout);
      if (graceTimer) clearTimeout(graceTimer);
      // Persist logs on error and KEEP run dir
      try {
        writeFileSync(join(work, 'child.stdout'), out, 'utf8');
        writeFileSync(join(work, 'child.stderr'), err, 'utf8');
      } catch {
        /* empty */
      }
      rejectP(e);
    };

    // ---- wire streams ----
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');

    child.stdout!.on('data', (c: string) => {
      out += c;
      totalBytes += Buffer.byteLength(c);
      if (totalBytes > MAX_BYTES) {
        killTree(child, true);
        return rejectOnce(new Error('Tool produced too much output; limit is 10MB'));
      }
      if (parsed == null) {
        const got = incr.push(c);
        if (got != null) {
          parsed = got;
          startGrace(); // start grace-after-JSON window
        }
      }
    });

    child.stderr!.on('data', (c: string) => {
      err += c;
      totalBytes += Buffer.byteLength(c);
      // TODO:
      // if (opts.verbose) {
      //   // tee to host logs if desired
      //   for (const line of c.split(/\r?\n/)) {
      //     if (line) console.error(`[tool] ${line}`);
      //   }
      // }
      if (totalBytes > MAX_BYTES) {
        killTree(child, true);
        return rejectOnce(new Error('Tool produced too much output; limit is 10MB'));
      }
    });

    child.on('error', (e) => {
      rejectOnce(e as Error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (graceTimer) clearTimeout(graceTimer);

      const runnerForcedExit = sentTERM || sentKILL;

      // Prefer the streaming-parsed JSON; if none and exit 0, last-chance parse
      if (parsed == null && code === 0) {
        try {
          parsed = JSON.parse(out.trim());
        } catch {
          // keep run dir for inspection
          // TODO:
          // try {
          //   writeFileSync(join(workDir, "child.stdout"), out, "utf8");
          //   writeFileSync(join(workDir, "child.stderr"), err, "utf8");
          // } catch {}
          return rejectP(
            new Error(`Failed to parse tool JSON output.\nStderr:\n${err}\nStdout:\n${out}`),
          );
        }
      }

      if (code !== 0 && !runnerForcedExit) {
        // Child failed on its own → persist logs & raise
        try {
          writeFileSync(join(work, 'child.stdout'), out, 'utf8');
          writeFileSync(join(work, 'child.stderr'), err, 'utf8');
        } catch {
          /* empty */
        }
        const tail = err.slice(-4000);
        return rejectP(new Error(`Tool exited with code ${code}. Stderr (tail):\n${tail}`));
      }

      if (parsed == null) {
        // Shouldn't happen if we killed after JSON; keep logs
        // TODO:
        // try {
        //   writeFileSync(join(workDir, "child.stdout"), out, "utf8");
        //   writeFileSync(join(workDir, "child.stderr"), err, "utf8");
        // } catch {
        // }
        return rejectP(
          new Error(`Tool did not produce valid JSON.\nStderr:\n${err}\nStdout:\n${out}`),
        );
      }

      // Success: cleanup and return parsed JSON
      try {
        rmSync(work, { recursive: true, force: true });
      } catch {
        /* empty */
      }
      resolveP(parsed as JsonValue);
    });

    try {
      child.stdin!.end(JSON.stringify(payload));
    } catch {
      // ignore; child may have already died
    }
  });
}

function extractFirstJsonIncremental() {
  let buf = '';
  let depth = 0;
  let start = -1;
  return {
    push(chunk: string): unknown | null {
      buf += chunk;
      for (let i = 0; i < chunk.length; i++) {
        const ch = buf.charAt(buf.length - chunk.length + i);
        if (ch === '{') {
          if (depth === 0) start = buf.length - chunk.length + i;
          depth++;
        } else if (ch === '}') {
          if (depth > 0) {
            depth--;
            if (depth === 0 && start >= 0) {
              const slice = buf.slice(start, buf.length - chunk.length + i + 1);
              try {
                return JSON.parse(slice);
              } catch {
                // keep scanning
              }
            }
          }
        }
      }
      return null;
    },
    fullText() {
      return buf;
    },
  };
}

function killTree(child: import('node:child_process').ChildProcess, hard = false) {
  try {
    if (platform() === 'win32') {
      // Best-effort: taskkill the whole tree
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', hard ? '/F' : ''].filter(Boolean), {
        stdio: 'ignore',
      });
      try {
        child.kill(hard ? 'SIGKILL' : 'SIGTERM');
      } catch {
        /* empty */
      }
    } else {
      // POSIX: send to process group (we use detached: true)
      try {
        process.kill(-child.pid!, hard ? 'SIGKILL' : 'SIGTERM');
      } catch {
        /* empty */
      }
      try {
        child.kill(hard ? 'SIGKILL' : 'SIGTERM');
      } catch {
        /* empty */
      }
    }
  } catch {
    /* empty */
  }
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

  let root: string;
  let manifestPath: string;
  try {
    ({ root, manifestPath } = resolveToolRoot(spec, options.toolDirOverride));
  } catch (err) {
    try {
      resolveSkillRoot(spec);
      throw new Error(
        `Package "${spec}" is a Skill. load() is tool-only; use loadSkill("${spec}") instead.`,
      );
    } catch (skillErr) {
      if (skillErr instanceof Error && skillErr.message.includes('loadSkill(')) {
        throw skillErr;
      }
      if (err instanceof Error && err.message.includes('not found in .agentpm/tools')) {
        throw new Error(
          `${err.message} If this package is a Skill, use loadSkill("${spec}") instead.`,
        );
      }
      throw err;
    }
  }
  const manifest = readManifest(manifestPath);

  const ep = manifest.entrypoint;
  dprint(`resolved root=${root}`);
  dprint(`manifest=${manifestPath}`);
  dprint(`entry.command="${ep['command']}" args=${ep.args ?? []}`);

  const env = ep.env ?? {};

  // enforce expected/required environment
  const expectedEnv = manifest.environment;
  const varsObj = expectedEnv?.vars ?? {};
  const hasVars = varsObj && typeof varsObj === 'object' && Object.values(varsObj).length > 0;
  if (hasVars) {
    dprint(`tool-defined environment=${JSON.stringify(manifest.environment)}`);

    Object.entries(varsObj).forEach(([k, v]) => {
      if (v.required && !v.default && (!options.env || !(k in options.env))) {
        throw new Error(
          `Missing environment variable: ${k}. ${k} is required and has no default value.`,
        );
      } else if (v.default && (!options.env || !(k in options.env))) {
        // set default
        options.env = options.env || {};
        options.env[k] = v.default;
      }
    });
  }

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
      environment: manifest.environment,
    };
    return { func, meta };
  }
  return func;
}

export async function loadAgent(
  spec: string,
  options: LoadAgentOptions = {},
): Promise<LoadedAgent> {
  const { root, manifestPath, packageName } = resolveAgentRoot(spec, options.agentDirOverride);
  const manifest = readAgentManifest(manifestPath);

  const lockfilePath = resolveAgentLockfilePath(options.lockfileOverride);
  if (!existsSync(lockfilePath)) {
    throw new Error(
      `agent.lock not found at ${lockfilePath}; installed agent metadata requires a lockfile v2. Run "agentpm install" to generate the lockfile.`,
    );
  }

  const lock = readLockfileV2(lockfilePath);
  const packageKey = `agent:${packageName}@${manifest.version}`;
  const rootEntry = lock.roots?.[packageKey];
  if (!rootEntry) {
    throw new Error(
      `Agent root "${packageKey}" not found in ${lockfilePath}; install the agent with agentpm install first.`,
    );
  }

  const rootReserved = rootEntry.reserved ?? {};
  const reserved: ReservedReferences = {
    knowledge: rootReserved.knowledge ?? [],
    memory: rootReserved.memory ?? [],
    profiles: rootReserved.profiles ?? [],
  };

  const resolvedTools: ResolvedAgentToolRef[] = (rootEntry.tools ?? []).flatMap((toolKey) => {
    const pkg = lock.packages?.[toolKey];
    if (!pkg || pkg.kind !== 'tool') return [];

    const installed = resolveToolInstalledPath(pkg.name, pkg.version, options.toolDirOverride);
    return [
      {
        packageKey: toolKey,
        kind: 'tool',
        name: pkg.name,
        version: pkg.version,
        integrity: pkg.integrity,
        root: installed?.root ?? null,
        manifestPath: installed?.manifestPath ?? null,
      },
    ];
  });

  const resolvedSkills: ResolvedAgentSkillRef[] = (rootEntry.skills ?? []).flatMap((skillKey) => {
    const pkg = lock.packages?.[skillKey];
    if (!pkg || pkg.kind !== 'skill') return [];

    const installed = resolveSkillInstalledPath(pkg.name, pkg.version, options.skillDirOverride);
    return [
      {
        packageKey: skillKey,
        kind: 'skill',
        name: pkg.name,
        version: pkg.version,
        integrity: pkg.integrity,
        root: installed?.root ?? null,
        manifestPath: installed?.manifestPath ?? null,
      },
    ];
  });

  return {
    root,
    manifestPath,
    manifest,
    resolvedTools,
    resolvedSkills,
    reserved,
  };
}

function resolvedToolsFromLockKeys(
  toolKeys: string[],
  packages: Record<string, LockedPackage>,
  toolDirOverride?: string,
): ResolvedAgentToolRef[] {
  return toolKeys.flatMap((toolKey) => {
    const pkg = packages[toolKey];
    if (!pkg || pkg.kind !== 'tool') return [];

    const installed = resolveToolInstalledPath(pkg.name, pkg.version, toolDirOverride);
    return [
      {
        packageKey: toolKey,
        kind: 'tool',
        name: pkg.name,
        version: pkg.version,
        integrity: pkg.integrity,
        root: installed?.root ?? null,
        manifestPath: installed?.manifestPath ?? null,
      },
    ];
  });
}

function parseDependencyReference(ref: DependencyReference): {
  name: string;
  version: string | null;
} {
  if (typeof ref === 'string') {
    const atIdx = ref.lastIndexOf('@');
    if (atIdx <= 0 || atIdx === ref.length - 1) {
      return { name: ref, version: null };
    }
    return {
      name: ref.slice(0, atIdx),
      version: ref.slice(atIdx + 1),
    };
  }

  return {
    name: ref.name,
    version: ref.version ?? null,
  };
}

function resolvedToolsFromSkillManifest(
  skillSpecName: string,
  skillVersion: string,
  toolRefs: DependencyReference[],
  packages: Record<string, LockedPackage>,
  lockfilePath: string,
  toolDirOverride?: string,
): ResolvedAgentToolRef[] {
  return toolRefs.map((ref) => {
    const { name, version } = parseDependencyReference(ref);

    let toolKey: string;
    let pkg: LockedPackage | undefined;
    if (version == null) {
      const matches = Object.entries(packages).filter(
        ([, candidate]) => candidate.kind === 'tool' && candidate.name === name,
      );
      if (matches.length !== 1) {
        throw new Error(
          `Skill "${skillSpecName}@${skillVersion}" declares tool dependency "${name}" without an exact version, and it could not be resolved uniquely from ${lockfilePath}.`,
        );
      }
      [toolKey, pkg] = matches[0];
    } else {
      toolKey = `tool:${name}@${version}`;
      pkg = packages[toolKey];
      if (!pkg || pkg.kind !== 'tool') {
        throw new Error(
          `Skill "${skillSpecName}@${skillVersion}" declares tool dependency "${name}@${version}" that is not present in ${lockfilePath}. Run "agentpm install" to refresh the lockfile.`,
        );
      }
    }
    const resolvedPkg = pkg!;

    const installed = resolveToolInstalledPath(
      resolvedPkg.name,
      resolvedPkg.version,
      toolDirOverride,
    );
    return {
      packageKey: toolKey,
      kind: 'tool' as const,
      name: resolvedPkg.name,
      version: resolvedPkg.version,
      integrity: resolvedPkg.integrity,
      root: installed?.root ?? null,
      manifestPath: installed?.manifestPath ?? null,
    };
  });
}

export async function loadSkill(
  spec: string,
  options: LoadSkillOptions = {},
): Promise<LoadedSkill> {
  const { root, manifestPath, packageName } = resolveSkillRoot(spec, options.skillDirOverride);
  const manifest = readSkillManifest(manifestPath);

  const lockfilePath = resolveAgentLockfilePath(options.lockfileOverride);
  if (!existsSync(lockfilePath)) {
    throw new Error(
      `agent.lock not found at ${lockfilePath}; installed skill metadata requires a lockfile v3. Run "agentpm install" to generate the lockfile.`,
    );
  }

  const lock = readLockfileV2(lockfilePath);
  const packageKey = `skill:${packageName}@${manifest.version}`;
  const rootEntry = lock.roots?.[packageKey];
  const packages = lock.packages ?? {};
  const resolvedTools: ResolvedAgentToolRef[] = rootEntry
    ? resolvedToolsFromLockKeys(rootEntry.tools ?? [], packages, options.toolDirOverride)
    : resolvedToolsFromSkillManifest(
        packageName,
        manifest.version,
        manifest.tools ?? [],
        packages,
        lockfilePath,
        options.toolDirOverride,
      );

  const entrypointPath = resolve(root, manifest.skill.entrypoint);
  const entrypointContent = readFileSync(entrypointPath, 'utf-8');

  return {
    kind: 'skill',
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    root,
    manifestPath,
    manifest,
    skill: manifest.skill,
    entrypointPath,
    entrypointContent,
    references: manifest.skill.references ?? [],
    scripts: manifest.skill.scripts ?? [],
    resolvedTools,
  };
}
