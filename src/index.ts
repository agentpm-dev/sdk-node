import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import fs from 'node:fs';
import path from 'node:path';

import semver from 'semver';

import { invoke } from './cli';

export * from './harness';

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
  loop?: DependencyReference;
  bindings?: AgentBindings;
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

export type KnowledgeMode = 'context' | 'vector';

export type KnowledgeDocument = {
  path: string;
  content_type?: string;
  role?: string;
  description?: string;
  bytes?: number;
  sha256?: string;
};

export type KnowledgeContext = {
  document_count?: number;
  total_bytes?: number;
  content_hash?: string;
};

export type KnowledgeCorpus = {
  chunks_path?: string;
  sources_path?: string;
  chunk_count?: number;
  source_count?: number;
  content_hash?: string;
};

export type KnowledgeEmbedding = {
  id?: string;
  provider?: string;
  model?: string;
  dimensions?: number;
  metric?: string;
  normalized?: boolean;
  vectors_path?: string;
  vector_count?: number;
  vectors_hash?: string;
};

export type KnowledgeIndex = {
  id?: string;
  type?: string;
  path?: string;
  embedding_id?: string;
  generated_by?: string;
};

export type KnowledgeRetrieval = {
  strategy?: string;
  default_top_k?: number;
  default_score_threshold?: number;
  return_citations?: boolean;
};

export type KnowledgeBuilder = {
  name?: string;
  version?: string;
};

export type KnowledgeProvenance = {
  sources_manifest_path?: string;
  generated_at?: string;
  builder?: KnowledgeBuilder;
};

export type KnowledgeMetadata = {
  mode: KnowledgeMode;
  content_type?: string;
  language?: string;
  documents?: KnowledgeDocument[];
  context?: KnowledgeContext;
  corpus?: KnowledgeCorpus;
  embedding?: KnowledgeEmbedding;
  indexes?: KnowledgeIndex[];
  retrieval?: KnowledgeRetrieval;
  provenance?: KnowledgeProvenance;
};

export type KnowledgeMeta = {
  kind: 'knowledge';
  name: string;
  version: string;
  description?: string;
  knowledge: KnowledgeMetadata;
};

export type MemoryScope = {
  description?: string;
};

export type MemoryRecordType = {
  description?: string;
  schema: string;
  version: string;
};

export type MemoryRetrieval = {
  modes: string[];
};

export type MemoryCapacity = {
  max_records?: number;
};

export type MemoryRetention = {
  ttl?: string;
  on_expire?: string;
};

export type MemoryConstraints = {
  append_only?: boolean;
};

export type MemorySpace = {
  description?: string;
  model: string;
  scope: string[];
  record_types: string[];
  retrieval: MemoryRetrieval;
  capacity?: MemoryCapacity;
  retention?: MemoryRetention;
  constraints?: MemoryConstraints;
};

export type MemoryOperationRef = {
  space: string;
  record_type: string;
};

export type MemoryOperationTarget = {
  space: string;
  record_type: string;
};

export type MemoryOperationTrigger = {
  type: string;
  space?: string;
  threshold?: number;
  every?: string;
};

export type MemoryOperation = {
  type: string;
  description?: string;
  inputs?: MemoryOperationRef[];
  output?: MemoryOperationRef;
  output_mode?: string;
  targets?: MemoryOperationTarget[];
  trigger?: MemoryOperationTrigger;
  source_handling?: string;
  preserve_provenance?: boolean;
  cascade_derived_records?: boolean;
};

export type MemoryMetadata = {
  scopes: Record<string, MemoryScope>;
  record_types: Record<string, MemoryRecordType>;
  spaces: Record<string, MemorySpace>;
  operations?: Record<string, MemoryOperation>;
};

export type MemoryMeta = {
  kind: 'memory';
  name: string;
  version: string;
  description?: string;
  memory: MemoryMetadata;
};

export type ProfileIdentity = {
  role: string;
  description?: string;
  expertise?: string[];
};

export type ProfileAudience = {
  description?: string;
  assumed_knowledge?: string;
  adaptation?: string[];
};

export type ProfileVocabulary = {
  prefer?: string[];
  avoid?: string[];
};

export type ProfileCommunication = {
  tone: string[];
  verbosity: 'concise' | 'balanced' | 'detailed';
  guidelines?: string[];
  formatting?: string[];
  vocabulary?: ProfileVocabulary;
};

export type ProfileConstraint = {
  id: string;
  strength: 'required' | 'preferred';
  instruction: string;
};

export type ProfileCapabilityHints = {
  tool_use?: boolean;
  structured_output?: boolean;
  multimodal_input?: boolean;
};

export type ProfileCompatibility = {
  minimum_context_tokens?: number;
  requires?: ProfileCapabilityHints;
  recommends?: ProfileCapabilityHints;
};

export type ProfileMetadata = {
  identity: ProfileIdentity;
  objectives: string[];
  principles?: string[];
  audience?: ProfileAudience;
  communication: ProfileCommunication;
  boundaries?: string[];
  constraints?: ProfileConstraint[];
  compatibility?: ProfileCompatibility;
};

export type ProfileMeta = {
  kind: 'profile';
  name: string;
  version: string;
  description?: string;
  profile: ProfileMetadata;
};

export type LoopPhaseAccessMemory = {
  read?: boolean;
  write?: boolean;
};

export type LoopPhaseAccess = {
  tools?: boolean;
  knowledge?: boolean;
  memory?: LoopPhaseAccessMemory;
};

export type LoopOutcome = {
  id: string;
  description: string;
};

export type LoopPhase = {
  id: string;
  objective: string;
  access?: LoopPhaseAccess;
  outcomes?: LoopOutcome[];
};

export type LoopTransition = {
  from: string;
  on: string;
  to: string;
};

export type LoopLimits = {
  max_steps?: number;
};

export type LoopCheckpoint = {
  id: string;
  type: 'approval';
  before_phase: string;
  on_reject: string;
};

export type LoopToolFailurePolicy =
  | {
      action: 'retry';
      max_retries: number;
      on_exhausted: 'fail_phase' | 'abort' | 'handoff';
    }
  | {
      action: 'fail_phase' | 'abort' | 'handoff';
    };

export type LoopPhaseFailurePolicy = {
  action: 'abort' | 'handoff';
};

export type LoopErrorPolicy = {
  tool_failure?: LoopToolFailurePolicy;
  phase_failure?: LoopPhaseFailurePolicy;
};

export type LoopMetadata = {
  archetype?: string;
  entry_phase: string;
  limits?: LoopLimits;
  phases: LoopPhase[];
  transitions: LoopTransition[];
  checkpoints?: LoopCheckpoint[];
  error_policy?: LoopErrorPolicy;
};

export type LoopMeta = {
  kind: 'loop';
  name: string;
  version: string;
  description?: string;
  loop: LoopMetadata;
};

export type AgentMemoryBinding = {
  package: string;
  spaces?: string[];
  operations?: string[];
};

export type AgentBindingScope = {
  tools?: string[];
  skills?: string[];
  knowledge?: string[];
  memory?: AgentMemoryBinding[];
  profiles?: string[];
};

export type AgentMcpBinding = {
  id: string;
  tools: string[];
};

export type AgentConsumerContext = {
  file: string;
};

export type AgentBindings = {
  global?: AgentBindingScope;
  phases?: Record<string, AgentBindingScope>;
  mcp?: AgentMcpBinding[];
  consumer_context?: AgentConsumerContext;
};

export type MemoryBuildSourceSchemaEntry = {
  path: string;
  sha256: string;
};

export type MemoryBuildMetadata = {
  type: string;
  format_version: number;
  built_at?: string;
  agentpm_version?: string;
  manifest_path: string;
  source_manifest_hash: string;
  source_schemas?: MemoryBuildSourceSchemaEntry[];
  source_schemas_hash: string;
  source_contract_inputs_hash: string;
  contracts_index_hash: string;
  contracts_hash: string;
  contract_count: number;
};

export type MemoryContractIndexEntry = {
  space: string;
  record_type: string;
  schema_version: string;
  model: string;
  source_schema: string;
  path: string;
  sha256: string;
};

export type MemoryContractIndex = {
  type: string;
  format_version: number;
  contracts: MemoryContractIndexEntry[];
};

export type MemoryContractSchema = Record<string, unknown>;

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
type KnowledgeManifest = KnowledgeMeta;
type MemoryManifest = MemoryMeta;
type ProfileManifest = ProfileMeta;
type LoopManifest = LoopMeta;

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
  knowledgeDirOverride?: string;
  memoryDirOverride?: string;
  profileDirOverride?: string;
  loopDirOverride?: string;
  lockfileOverride?: string;
};

export type LoadSkillOptions = {
  skillDirOverride?: string;
  toolDirOverride?: string;
  lockfileOverride?: string;
};

export type LoadKnowledgeOptions = {
  knowledgeDirOverride?: string;
};

export type LoadMemoryOptions = {
  memoryDirOverride?: string;
};

export type LoadProfileOptions = {
  profileDirOverride?: string;
};

export type LoadLoopOptions = {
  loopDirOverride?: string;
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

export type ResolvedAgentKnowledgeRef = {
  packageKey: string;
  kind: 'knowledge';
  name: string;
  version: string;
  integrity: string;
  mode: KnowledgeMode | null;
  root: string | null;
  manifestPath: string | null;
};

export type ResolvedAgentMemoryRef = {
  packageKey: string;
  kind: 'memory';
  name: string;
  version: string;
  integrity: string;
  root: string | null;
  manifestPath: string | null;
};

export type ResolvedAgentProfileRef = {
  packageKey: string;
  kind: 'profile';
  name: string;
  version: string;
  integrity: string;
  root: string | null;
  manifestPath: string | null;
};

export type ResolvedAgentLoopRef = {
  packageKey: string;
  kind: 'loop';
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
  resolvedKnowledge: ResolvedAgentKnowledgeRef[];
  resolvedMemory: ResolvedAgentMemoryRef[];
  resolvedProfiles: ResolvedAgentProfileRef[];
  resolvedLoop: ResolvedAgentLoopRef | null;
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

export type LoadedKnowledge = {
  kind: 'knowledge';
  name: string;
  version: string;
  description?: string;
  root: string;
  manifestPath: string;
  manifest: KnowledgeManifest;
  knowledge: KnowledgeMetadata;
  documentPaths: string[];
  chunksPath: string | null;
  sourcesPath: string | null;
  vectorsPath: string | null;
  indexPaths: string[];
  provenancePath: string | null;
};

export type LoadedMemoryContractRef = {
  space: string;
  recordType: string;
  schemaVersion: string;
  model: string;
  sourceSchemaPath: string;
  path: string;
  sha256: string;
};

export type LoadedMemory = {
  kind: 'memory';
  name: string;
  version: string;
  description?: string;
  root: string;
  manifestPath: string;
  manifest: MemoryManifest;
  memory: MemoryMetadata;
  buildPath: string;
  build: MemoryBuildMetadata;
  contractIndexPath: string;
  contractIndex: MemoryContractIndex;
  sourceSchemaPaths: string[];
  contracts: LoadedMemoryContractRef[];
};

export type LoadedProfile = {
  kind: 'profile';
  name: string;
  version: string;
  description?: string;
  root: string;
  manifestPath: string;
  manifest: ProfileManifest;
  profile: ProfileMetadata;
};

export type LoadedLoop = {
  kind: 'loop';
  name: string;
  version: string;
  description?: string;
  root: string;
  manifestPath: string;
  manifest: LoopManifest;
  loop: LoopMetadata;
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
  knowledge?: string[];
  memory?: string[];
  profiles?: string[];
  loop?: string;
  reserved?: Partial<ReservedReferences>;
};

type LockfileV2 = {
  lockfile_version: number;
  packages?: Record<string, LockedPackage>;
  roots?: Record<string, LockedRoot>;
};

const DEFAULT_TIMEOUT_MS = 120_000;

function debugEnabled(): boolean {
  const v = process.env.AGENTPM_DEBUG || '';
  return v !== '' && !['0', 'false', 'no'].includes(v.toLowerCase());
}

function dprint(...args: unknown[]) {
  if (debugEnabled()) console.error('[agentpm-debug]', ...args);
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
      const installed = JSON.parse(readFileSync(manifest, 'utf8'));
      if (!installed || installed.version !== version)
        throw new Error(
          'Installed package version mismatch; run agentpm install again on this machine',
        );
      return { root: nested, manifestPath: manifest };
    }
  }
  return null;
}

function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, 'agent.json')) || existsSync(join(dir, 'agent.lock'))) return dir;
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

function resolveKnowledgeRoot(spec: string, knowledgeDirOverride?: string) {
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Invalid knowledge spec "${spec}". Expected "@scope/name@version".`);
  }
  const rangeOrVersion = spec.slice(atIdx + 1).trim();
  const name = spec.slice(0, atIdx);
  const projectRoot = findProjectRoot(process.cwd());

  const candidates = [
    knowledgeDirOverride,
    process.env.AGENTPM_KNOWLEDGE_DIR,
    resolve(projectRoot, '.agentpm/knowledge'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/knowledge') : undefined,
  ].filter(Boolean) as string[];

  if (semver.valid(rangeOrVersion)) {
    for (const base of candidates) {
      const hit = findInstalled(base, name, rangeOrVersion);
      if (hit) return { ...hit, packageName: name };
    }
    throw new Error(`Knowledge package "${spec}" not found in .agentpm/knowledge (or overrides).`);
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

function resolveMemoryRoot(spec: string, memoryDirOverride?: string) {
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Invalid memory spec "${spec}". Expected "@scope/name@version".`);
  }
  const rangeOrVersion = spec.slice(atIdx + 1).trim();
  const name = spec.slice(0, atIdx);
  const projectRoot = findProjectRoot(process.cwd());

  const candidates = [
    memoryDirOverride,
    process.env.AGENTPM_MEMORY_DIR,
    resolve(projectRoot, '.agentpm/memory'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/memory') : undefined,
  ].filter(Boolean) as string[];

  if (semver.valid(rangeOrVersion)) {
    for (const base of candidates) {
      const hit = findInstalled(base, name, rangeOrVersion);
      if (hit) return { ...hit, packageName: name };
    }
    throw new Error(`Memory package "${spec}" not found in .agentpm/memory (or overrides).`);
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

function resolveProfileRoot(spec: string, profileDirOverride?: string) {
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Invalid profile spec "${spec}". Expected "@scope/name@version".`);
  }
  const rangeOrVersion = spec.slice(atIdx + 1).trim();
  const name = spec.slice(0, atIdx);
  const projectRoot = findProjectRoot(process.cwd());

  const candidates = [
    profileDirOverride,
    process.env.AGENTPM_PROFILE_DIR,
    resolve(projectRoot, '.agentpm/profiles'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/profiles') : undefined,
  ].filter(Boolean) as string[];

  if (semver.valid(rangeOrVersion)) {
    for (const base of candidates) {
      const hit = findInstalled(base, name, rangeOrVersion);
      if (hit) return { ...hit, packageName: name };
    }
    throw new Error(`Profile package "${spec}" not found in .agentpm/profiles (or overrides).`);
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

function resolveLoopRoot(spec: string, loopDirOverride?: string) {
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Invalid loop spec "${spec}". Expected "@scope/name@version".`);
  }
  const rangeOrVersion = spec.slice(atIdx + 1).trim();
  const name = spec.slice(0, atIdx);
  const projectRoot = findProjectRoot(process.cwd());

  const candidates = [
    loopDirOverride,
    process.env.AGENTPM_LOOP_DIR,
    resolve(projectRoot, '.agentpm/loops'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/loops') : undefined,
  ].filter(Boolean) as string[];

  if (semver.valid(rangeOrVersion)) {
    for (const base of candidates) {
      const hit = findInstalled(base, name, rangeOrVersion);
      if (hit) return { ...hit, packageName: name };
    }
    throw new Error(`Loop package "${spec}" not found in .agentpm/loops (or overrides).`);
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

function readKnowledgeManifest(path: string): KnowledgeManifest {
  const raw = readFileSync(path, 'utf-8');
  const manifest = JSON.parse(raw) as KnowledgeManifest;
  if (manifest?.kind !== 'knowledge') {
    throw new Error(`agent.json is not a knowledge manifest at: ${path}`);
  }
  if (!manifest.knowledge?.mode) {
    throw new Error(`agent.json missing knowledge.mode at: ${path}`);
  }
  return manifest;
}

function readMemoryManifest(path: string): MemoryManifest {
  const raw = readFileSync(path, 'utf-8');
  const manifest = JSON.parse(raw) as MemoryManifest;
  if (manifest?.kind !== 'memory') {
    throw new Error(`agent.json is not a memory manifest at: ${path}`);
  }
  if (!manifest.memory || typeof manifest.memory !== 'object' || Array.isArray(manifest.memory)) {
    throw new Error(`agent.json missing memory object at: ${path}`);
  }
  return manifest;
}

function readProfileManifest(path: string): ProfileManifest {
  const raw = readFileSync(path, 'utf-8');
  const manifest = JSON.parse(raw) as ProfileManifest;
  if (manifest?.kind !== 'profile') {
    throw new Error(`agent.json is not a profile manifest at: ${path}`);
  }
  if (
    !manifest.profile ||
    typeof manifest.profile !== 'object' ||
    Array.isArray(manifest.profile)
  ) {
    throw new Error(`agent.json missing profile object at: ${path}`);
  }
  return manifest;
}

function readLoopManifest(path: string): LoopManifest {
  const raw = readFileSync(path, 'utf-8');
  const manifest = JSON.parse(raw) as LoopManifest;
  if (manifest?.kind !== 'loop') {
    throw new Error(`agent.json is not a loop manifest at: ${path}`);
  }
  if (!manifest.loop || typeof manifest.loop !== 'object' || Array.isArray(manifest.loop)) {
    throw new Error(`agent.json missing loop object at: ${path}`);
  }
  return manifest;
}

// Historical name: this helper now accepts modern agent.lock shapes v2 and v3.
// Keep the narrower name for now to avoid internal churn while Skills remain the
// only v3-specific addition on top of the same overall lock envelope.
function readLockfileV2(lockfilePath: string): LockfileV2 {
  const malformed = (): never => {
    throw new Error(`Malformed agent.lock at ${lockfilePath}; run agentpm install to repair it`);
  };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  } catch {
    return malformed();
  }
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (
    !object(value) ||
    !Number.isInteger(value.lockfile_version) ||
    ![2, 3, 4].includes(value.lockfile_version as number)
  ) {
    throw new Error(
      `Unsupported lockfile version at ${lockfilePath}; expected agent.lock v2, v3 or v4. Update AgentPM CLI/SDK and run agentpm install.`,
    );
  }
  if (!object(value.packages) || !object(value.roots)) return malformed();
  const packages = value.packages;
  for (const [key, pkg] of Object.entries(packages)) {
    if (
      !object(pkg) ||
      ['kind', 'name', 'version', 'integrity'].some(
        (field) => typeof pkg[field] !== 'string' || !pkg[field],
      )
    )
      return malformed();
    if (key !== `${pkg.kind}:${pkg.name}@${pkg.version}`) return malformed();
    if (pkg.python_resolution != null && !object(pkg.python_resolution)) return malformed();
  }
  for (const root of Object.values(value.roots)) {
    if (!object(root)) return malformed();
    for (const [field, kind] of Object.entries({
      tools: 'tool',
      skills: 'skill',
      knowledge: 'knowledge',
      memory: 'memory',
      profiles: 'profile',
    })) {
      const refs = Object.hasOwn(root, field) ? root[field] : [];
      if (
        !Array.isArray(refs) ||
        refs.some(
          (ref) =>
            typeof ref !== 'string' ||
            !object(packages[ref]) ||
            (packages[ref] as Record<string, unknown>).kind !== kind,
        )
      )
        return malformed();
    }
    if (
      root.loop != null &&
      (typeof root.loop !== 'string' ||
        !object(packages[root.loop]) ||
        (packages[root.loop] as Record<string, unknown>).kind !== 'loop')
    )
      return malformed();
    if (
      Object.hasOwn(root, 'reserved') &&
      (!object(root.reserved) ||
        ['skills', 'knowledge', 'memory', 'profiles'].some(
          (field) =>
            Object.hasOwn(root.reserved as object, field) &&
            !Array.isArray((root.reserved as Record<string, unknown>)[field]),
        ))
    )
      return malformed();
  }
  return value as LockfileV2;
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

function resolveKnowledgeInstalledPath(
  name: string,
  version: string,
  knowledgeDirOverride?: string,
): { root: string; manifestPath: string } | null {
  const projectRoot = findProjectRoot(process.cwd());
  const candidates = [
    knowledgeDirOverride,
    process.env.AGENTPM_KNOWLEDGE_DIR,
    resolve(projectRoot, '.agentpm/knowledge'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/knowledge') : undefined,
  ].filter(Boolean) as string[];

  for (const base of candidates) {
    const hit = findInstalled(base, name, version);
    if (hit) return hit;
  }
  return null;
}

function resolveMemoryInstalledPath(
  name: string,
  version: string,
  memoryDirOverride?: string,
): { root: string; manifestPath: string } | null {
  const projectRoot = findProjectRoot(process.cwd());
  const candidates = [
    memoryDirOverride,
    process.env.AGENTPM_MEMORY_DIR,
    resolve(projectRoot, '.agentpm/memory'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/memory') : undefined,
  ].filter(Boolean) as string[];

  for (const base of candidates) {
    const hit = findInstalled(base, name, version);
    if (hit) return hit;
  }
  return null;
}

function resolveProfileInstalledPath(
  name: string,
  version: string,
  profileDirOverride?: string,
): { root: string; manifestPath: string } | null {
  const projectRoot = findProjectRoot(process.cwd());
  const candidates = [
    profileDirOverride,
    process.env.AGENTPM_PROFILE_DIR,
    resolve(projectRoot, '.agentpm/profiles'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/profiles') : undefined,
  ].filter(Boolean) as string[];

  for (const base of candidates) {
    const hit = findInstalled(base, name, version);
    if (hit) return hit;
  }
  return null;
}

function resolveLoopInstalledPath(
  name: string,
  version: string,
  loopDirOverride?: string,
): { root: string; manifestPath: string } | null {
  const projectRoot = findProjectRoot(process.cwd());
  const candidates = [
    loopDirOverride,
    process.env.AGENTPM_LOOP_DIR,
    resolve(projectRoot, '.agentpm/loops'),
    process.env.HOME ? resolve(process.env.HOME, '.agentpm/loops') : undefined,
  ].filter(Boolean) as string[];

  for (const base of candidates) {
    const hit = findInstalled(base, name, version);
    if (hit) return hit;
  }
  return null;
}

function isSafeRelativePath(value: string): boolean {
  if (!value || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    return false;
  }
  return !normalized.split('/').includes('..');
}

function ensureInsideRoot(rootRealPath: string, targetRealPath: string, fieldLabel: string): void {
  const relative = path.relative(rootRealPath, targetRealPath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${fieldLabel} resolves outside the installed memory package root.`);
  }
}

function resolveInstalledMemoryFile(
  root: string,
  relativePath: string,
  fieldLabel: string,
  requiredPrefix?: string,
): string {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`${fieldLabel} must be a safe package-relative path.`);
  }

  const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
  if (requiredPrefix && !normalized.startsWith(requiredPrefix)) {
    throw new Error(`${fieldLabel} must remain under ${requiredPrefix}.`);
  }

  const rootRealPath = fs.realpathSync(root);
  const resolvedPath = resolve(root, normalized);
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`${fieldLabel} is missing at ${normalized}.`);
  }

  const targetRealPath = fs.realpathSync(resolvedPath);
  ensureInsideRoot(rootRealPath, targetRealPath, fieldLabel);
  return targetRealPath;
}

function readJsonFile(pathname: string, fieldLabel: string): JsonValue {
  try {
    return JSON.parse(readFileSync(pathname, 'utf-8')) as JsonValue;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${fieldLabel} is not valid JSON: ${detail}`);
  }
}

function requireObjectRecord(value: JsonValue, fieldLabel: string): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldLabel} must be a JSON object.`);
  }
  return value as Record<string, JsonValue>;
}

function readMemoryBuildMetadata(root: string): { path: string; build: MemoryBuildMetadata } {
  const buildPath = resolveInstalledMemoryFile(root, 'memory/build.json', 'memory/build.json');
  const buildJson = requireObjectRecord(
    readJsonFile(buildPath, 'memory/build.json'),
    'memory/build.json',
  );

  if (buildJson.type !== 'agentpm-memory-contracts') {
    throw new Error('memory/build.json has unsupported type.');
  }
  if (buildJson.format_version !== 1) {
    throw new Error('memory/build.json has unsupported format_version.');
  }
  if (typeof buildJson.manifest_path !== 'string' || buildJson.manifest_path.length === 0) {
    throw new Error('memory/build.json missing manifest_path.');
  }
  for (const field of [
    'source_manifest_hash',
    'source_schemas_hash',
    'source_contract_inputs_hash',
    'contracts_index_hash',
    'contracts_hash',
  ] as const) {
    if (typeof buildJson[field] !== 'string' || buildJson[field].length === 0) {
      throw new Error(`memory/build.json missing ${field}.`);
    }
  }
  if (typeof buildJson.contract_count !== 'number' || !Number.isInteger(buildJson.contract_count)) {
    throw new Error('memory/build.json missing contract_count.');
  }
  if (
    buildJson.source_schemas !== undefined &&
    (!Array.isArray(buildJson.source_schemas) ||
      buildJson.source_schemas.some(
        (entry) =>
          !entry ||
          typeof entry !== 'object' ||
          Array.isArray(entry) ||
          typeof (entry as Record<string, unknown>).path !== 'string' ||
          typeof (entry as Record<string, unknown>).sha256 !== 'string',
      ))
  ) {
    throw new Error('memory/build.json has invalid source_schemas entries.');
  }

  return { path: buildPath, build: buildJson as unknown as MemoryBuildMetadata };
}

function readMemoryContractIndex(
  root: string,
  memory: MemoryMetadata,
  expectedContractCount: number,
): {
  path: string;
  index: MemoryContractIndex;
  sourceSchemaPaths: string[];
  contracts: LoadedMemoryContractRef[];
} {
  const indexPath = resolveInstalledMemoryFile(
    root,
    'memory/contracts/index.json',
    'memory/contracts/index.json',
    'memory/contracts/',
  );
  const indexJson = requireObjectRecord(
    readJsonFile(indexPath, 'memory/contracts/index.json'),
    'memory/contracts/index.json',
  );

  if (indexJson.type !== 'agentpm-memory-contract-index') {
    throw new Error('memory/contracts/index.json has unsupported type.');
  }
  if (indexJson.format_version !== 1) {
    throw new Error('memory/contracts/index.json has unsupported format_version.');
  }
  if (!Array.isArray(indexJson.contracts)) {
    throw new Error('memory/contracts/index.json missing contracts array.');
  }
  if (indexJson.contracts.length !== expectedContractCount) {
    throw new Error('memory/build.json contract_count does not match memory/contracts/index.json.');
  }

  const sourceSchemaPaths = new Set<string>();
  const seenIdentities = new Set<string>();
  const seenPaths = new Set<string>();
  const contracts: LoadedMemoryContractRef[] = [];

  for (const [index, entry] of indexJson.contracts.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`memory/contracts/index.json contract entry ${index} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const space = record.space;
    const recordType = record.record_type;
    const schemaVersion = record.schema_version;
    const model = record.model;
    const sourceSchema = record.source_schema;
    const contractPath = record.path;
    const sha256 = record.sha256;

    if (
      typeof space !== 'string' ||
      typeof recordType !== 'string' ||
      typeof schemaVersion !== 'string' ||
      typeof model !== 'string' ||
      typeof sourceSchema !== 'string' ||
      typeof contractPath !== 'string' ||
      typeof sha256 !== 'string'
    ) {
      throw new Error(
        `memory/contracts/index.json contract entry ${index} is missing required fields.`,
      );
    }

    const declaredRecordType = memory.record_types[recordType];
    if (!declaredRecordType || declaredRecordType.schema !== sourceSchema) {
      throw new Error(
        `memory/contracts/index.json references undeclared source schema "${sourceSchema}".`,
      );
    }

    const identity = `${space}:${recordType}`;
    if (seenIdentities.has(identity)) {
      throw new Error(
        `memory/contracts/index.json contains duplicate contract entry "${identity}".`,
      );
    }
    seenIdentities.add(identity);
    if (seenPaths.has(contractPath)) {
      throw new Error(
        `memory/contracts/index.json contains duplicate contract path "${contractPath}".`,
      );
    }
    seenPaths.add(contractPath);

    const resolvedContractPath = resolveInstalledMemoryFile(
      root,
      contractPath,
      `memory/contracts/index.json contract path "${contractPath}"`,
      'memory/contracts/',
    );
    const resolvedSourceSchemaPath = resolveInstalledMemoryFile(
      root,
      sourceSchema,
      `memory/contracts/index.json source schema "${sourceSchema}"`,
    );
    sourceSchemaPaths.add(resolvedSourceSchemaPath);

    contracts.push({
      space,
      recordType,
      schemaVersion,
      model,
      sourceSchemaPath: resolvedSourceSchemaPath,
      path: resolvedContractPath,
      sha256,
    });
  }

  return {
    path: indexPath,
    index: indexJson as unknown as MemoryContractIndex,
    sourceSchemaPaths: [...sourceSchemaPaths].sort(),
    contracts,
  };
}

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
      try {
        resolveKnowledgeRoot(spec);
        throw new Error(
          `Package "${spec}" is Knowledge. load() is tool-only; use loadKnowledge("${spec}") instead.`,
        );
      } catch (knowledgeErr) {
        if (knowledgeErr instanceof Error && knowledgeErr.message.includes('loadKnowledge(')) {
          throw knowledgeErr;
        }
        try {
          resolveMemoryRoot(spec);
          throw new Error(
            `Package "${spec}" is Memory. load() is tool-only; use loadMemory("${spec}") instead.`,
          );
        } catch (memoryErr) {
          if (memoryErr instanceof Error && memoryErr.message.includes('loadMemory(')) {
            throw memoryErr;
          }
        }
        try {
          resolveLoopRoot(spec);
          throw new Error(
            `Package "${spec}" is a Loop. load() is tool-only; use loadLoop("${spec}") instead.`,
          );
        } catch (loopErr) {
          if (loopErr instanceof Error && loopErr.message.includes('loadLoop(')) {
            throw loopErr;
          }
        }
        try {
          resolveProfileRoot(spec);
          throw new Error(
            `Package "${spec}" is a Profile. load() is tool-only; use loadProfile("${spec}") instead.`,
          );
        } catch (profileErr) {
          if (profileErr instanceof Error && profileErr.message.includes('loadProfile(')) {
            throw profileErr;
          }
        }
        if (err instanceof Error && err.message.includes('not found in .agentpm/tools')) {
          throw new Error(
            `${err.message} If this package is a Skill, use loadSkill("${spec}") instead. If it is Knowledge, use loadKnowledge("${spec}") instead. If it is Memory, use loadMemory("${spec}") instead. If it is a Loop, use loadLoop("${spec}") instead. If it is a Profile, use loadProfile("${spec}") instead.`,
          );
        }
        throw err;
      }
    }
  }
  const manifest = readManifest(manifestPath);

  const env = { ...options.env };
  const effective = { ...process.env, ...manifest.entrypoint.env, ...env };
  for (const [key, declaration] of Object.entries(manifest.environment?.vars ?? {})) {
    if (!(key in effective) && declaration.default !== undefined) {
      env[key] = declaration.default;
      effective[key] = declaration.default;
    }
    if (declaration.required && !(key in effective)) {
      throw new Error(
        `Missing environment variable: ${key}. ${key} is required and has no default value.`,
      );
    }
  }
  const timeoutMs = options.timeoutMs ?? manifest.entrypoint.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const project = findProjectRoot(process.cwd());
  const exactSpec = `${spec.slice(0, spec.lastIndexOf('@'))}@${manifest.version}`;
  const func = (input: JsonValue) =>
    invoke(project, root, exactSpec, input, timeoutMs, env, manifest.entrypoint.env);

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

  const resolvedKnowledge: ResolvedAgentKnowledgeRef[] = (rootEntry.knowledge ?? []).flatMap(
    (knowledgeKey) => {
      const pkg = lock.packages?.[knowledgeKey];
      if (!pkg || pkg.kind !== 'knowledge') return [];

      const installed = resolveKnowledgeInstalledPath(
        pkg.name,
        pkg.version,
        options.knowledgeDirOverride,
      );
      const manifest = installed ? readKnowledgeManifest(installed.manifestPath) : null;
      return [
        {
          packageKey: knowledgeKey,
          kind: 'knowledge' as const,
          name: pkg.name,
          version: pkg.version,
          integrity: pkg.integrity,
          mode: manifest?.knowledge.mode ?? null,
          root: installed?.root ?? null,
          manifestPath: installed?.manifestPath ?? null,
        },
      ];
    },
  );

  const resolvedMemory: ResolvedAgentMemoryRef[] = (rootEntry.memory ?? []).flatMap((memoryKey) => {
    const pkg = lock.packages?.[memoryKey];
    if (!pkg || pkg.kind !== 'memory') return [];

    const installed = resolveMemoryInstalledPath(pkg.name, pkg.version, options.memoryDirOverride);
    return [
      {
        packageKey: memoryKey,
        kind: 'memory',
        name: pkg.name,
        version: pkg.version,
        integrity: pkg.integrity,
        root: installed?.root ?? null,
        manifestPath: installed?.manifestPath ?? null,
      },
    ];
  });

  const resolvedProfiles: ResolvedAgentProfileRef[] = (rootEntry.profiles ?? []).flatMap(
    (profileKey) => {
      const pkg = lock.packages?.[profileKey];
      if (!pkg || pkg.kind !== 'profile') return [];

      const installed = resolveProfileInstalledPath(
        pkg.name,
        pkg.version,
        options.profileDirOverride,
      );
      return [
        {
          packageKey: profileKey,
          kind: 'profile' as const,
          name: pkg.name,
          version: pkg.version,
          integrity: pkg.integrity,
          root: installed?.root ?? null,
          manifestPath: installed?.manifestPath ?? null,
        },
      ];
    },
  );

  const resolvedLoop: ResolvedAgentLoopRef | null = (() => {
    const loopKey = rootEntry.loop;
    if (!loopKey) return null;
    const pkg = lock.packages?.[loopKey];
    if (!pkg || pkg.kind !== 'loop') return null;

    const installed = resolveLoopInstalledPath(pkg.name, pkg.version, options.loopDirOverride);
    return {
      packageKey: loopKey,
      kind: 'loop',
      name: pkg.name,
      version: pkg.version,
      integrity: pkg.integrity,
      root: installed?.root ?? null,
      manifestPath: installed?.manifestPath ?? null,
    };
  })();

  return {
    root,
    manifestPath,
    manifest,
    resolvedTools,
    resolvedSkills,
    resolvedKnowledge,
    resolvedMemory,
    resolvedProfiles,
    resolvedLoop,
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

export async function loadKnowledge(
  spec: string,
  options: LoadKnowledgeOptions = {},
): Promise<LoadedKnowledge> {
  const { root, manifestPath } = resolveKnowledgeRoot(spec, options.knowledgeDirOverride);
  const manifest = readKnowledgeManifest(manifestPath);

  const documentPaths = (manifest.knowledge.documents ?? []).map((document) =>
    resolve(root, document.path),
  );
  const chunksPath = manifest.knowledge.corpus?.chunks_path
    ? resolve(root, manifest.knowledge.corpus.chunks_path)
    : null;
  const sourcesPath = manifest.knowledge.corpus?.sources_path
    ? resolve(root, manifest.knowledge.corpus.sources_path)
    : null;
  const vectorsPath = manifest.knowledge.embedding?.vectors_path
    ? resolve(root, manifest.knowledge.embedding.vectors_path)
    : null;
  const indexPaths = (manifest.knowledge.indexes ?? [])
    .map((index) => index.path)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((indexPath) => resolve(root, indexPath));
  const provenancePath = manifest.knowledge.provenance?.sources_manifest_path
    ? resolve(root, manifest.knowledge.provenance.sources_manifest_path)
    : null;

  return {
    kind: 'knowledge',
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    root,
    manifestPath,
    manifest,
    knowledge: manifest.knowledge,
    documentPaths,
    chunksPath,
    sourcesPath,
    vectorsPath,
    indexPaths,
    provenancePath,
  };
}

export async function loadMemory(
  spec: string,
  options: LoadMemoryOptions = {},
): Promise<LoadedMemory> {
  const { root, manifestPath } = resolveMemoryRoot(spec, options.memoryDirOverride);
  const manifest = readMemoryManifest(manifestPath);
  const { path: buildPath, build } = readMemoryBuildMetadata(root);
  const {
    path: contractIndexPath,
    index: contractIndex,
    sourceSchemaPaths,
    contracts,
  } = readMemoryContractIndex(root, manifest.memory, build.contract_count);

  return {
    kind: 'memory',
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    root,
    manifestPath,
    manifest,
    memory: manifest.memory,
    buildPath,
    build,
    contractIndexPath,
    contractIndex,
    sourceSchemaPaths,
    contracts,
  };
}

export async function loadProfile(
  spec: string,
  options: LoadProfileOptions = {},
): Promise<LoadedProfile> {
  const { root, manifestPath } = resolveProfileRoot(spec, options.profileDirOverride);
  const manifest = readProfileManifest(manifestPath);

  return {
    kind: 'profile',
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    root,
    manifestPath,
    manifest,
    profile: manifest.profile,
  };
}

export async function loadLoop(spec: string, options: LoadLoopOptions = {}): Promise<LoadedLoop> {
  const { root, manifestPath } = resolveLoopRoot(spec, options.loopDirOverride);
  const manifest = readLoopManifest(manifestPath);

  return {
    kind: 'loop',
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    root,
    manifestPath,
    manifest,
    loop: manifest.loop,
  };
}

export function loadMemoryContract(
  memoryPackage: LoadedMemory,
  selector: { space: string; recordType: string },
): MemoryContractSchema {
  const contract = memoryPackage.contracts.find(
    (entry) => entry.space === selector.space && entry.recordType === selector.recordType,
  );
  if (!contract) {
    throw new Error(
      `Resolved memory contract "${selector.space}:${selector.recordType}" was not found in memory/contracts/index.json.`,
    );
  }

  return requireObjectRecord(
    readJsonFile(contract.path, `memory contract "${selector.space}:${selector.recordType}"`),
    `memory contract "${selector.space}:${selector.recordType}"`,
  ) as MemoryContractSchema;
}
