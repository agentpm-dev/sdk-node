import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadAgent } from '../src';

function makeInstalledTool(baseDir: string, spec: string) {
  const atIdx = spec.lastIndexOf('@');
  const name = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);
  const root = join(baseDir, `${name}/${version}`);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'agent.json'),
    JSON.stringify(
      {
        kind: 'tool',
        name,
        version,
        description: 'Installed tool fixture',
        entrypoint: { command: 'node', args: ['tool.js'] },
      },
      null,
      2,
    ),
    'utf8',
  );
}

function makeInstalledSkill(baseDir: string, spec: string) {
  const atIdx = spec.lastIndexOf('@');
  const packageName = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);
  const root = join(baseDir, `${packageName}/${version}`);
  const manifestName = packageName.slice(packageName.indexOf('/') + 1);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'SKILL.md'), '# Triage playbook\n\nUse the checklist.\n', 'utf8');
  writeFileSync(
    join(root, 'agent.json'),
    JSON.stringify(
      {
        kind: 'skill',
        name: manifestName,
        version,
        description: 'Installed skill fixture',
        tools: ['@zack/capitalize@0.1.0'],
        skill: {
          entrypoint: 'SKILL.md',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
}

function makeInstalledAgent(baseDir: string, spec: string, skillRef: string) {
  const atIdx = spec.lastIndexOf('@');
  const packageName = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);
  const root = join(baseDir, `${packageName}/${version}`);
  const manifestName = packageName.slice(packageName.indexOf('/') + 1);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'agent.json'),
    JSON.stringify(
      {
        kind: 'agent',
        name: manifestName,
        version,
        description: 'Installed agent fixture',
        tools: ['@zack/capitalize@0.1.0'],
        examples: [{ title: 'Example', prompt: 'Help the user.' }],
        skills: [skillRef],
        knowledge: [],
        memory: [],
        profiles: [],
      },
      null,
      2,
    ),
    'utf8',
  );
}

function makeInstalledKnowledge(baseDir: string, spec: string, mode: 'context' | 'vector') {
  const atIdx = spec.lastIndexOf('@');
  const packageName = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);
  const root = join(baseDir, `${packageName}/${version}`);
  const manifestName = packageName.slice(packageName.indexOf('/') + 1);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'agent.json'),
    JSON.stringify(
      mode === 'context'
        ? {
            kind: 'knowledge',
            name: manifestName,
            version,
            description: 'Installed knowledge fixture',
            knowledge: {
              mode: 'context',
              documents: [{ path: 'knowledge/docs/context.md' }],
            },
          }
        : {
            kind: 'knowledge',
            name: manifestName,
            version,
            description: 'Installed knowledge fixture',
            knowledge: {
              mode: 'vector',
              corpus: {
                chunks_path: 'knowledge/chunks.jsonl',
                sources_path: 'knowledge/sources.jsonl',
              },
              embedding: {
                vectors_path: 'knowledge/embeddings/default.f32',
              },
              indexes: [{ path: 'knowledge/indexes/default' }],
            },
          },
      null,
      2,
    ),
    'utf8',
  );
}

function makeInstalledMemory(baseDir: string, spec: string) {
  const atIdx = spec.lastIndexOf('@');
  const packageName = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);
  const root = join(baseDir, `${packageName}/${version}`);
  const manifestName = packageName.slice(packageName.indexOf('/') + 1);
  mkdirSync(join(root, 'schemas'), { recursive: true });
  mkdirSync(join(root, 'memory', 'contracts'), { recursive: true });
  writeFileSync(
    join(root, 'agent.json'),
    JSON.stringify(
      {
        kind: 'memory',
        name: manifestName,
        version,
        description: 'Installed memory fixture',
        memory: {
          scopes: { user: { description: 'User scope' } },
          record_types: {
            user_preference: {
              schema: 'schemas/user-preference.schema.json',
              version: '1.0.0',
            },
          },
          spaces: {
            profile: {
              model: 'document',
              scope: ['user'],
              record_types: ['user_preference'],
              retrieval: { modes: ['key'] },
            },
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    join(root, 'schemas', 'user-preference.schema.json'),
    JSON.stringify({ type: 'object' }, null, 2),
    'utf8',
  );
  writeFileSync(
    join(root, 'memory', 'build.json'),
    JSON.stringify(
      {
        type: 'agentpm-memory-contracts',
        format_version: 1,
        manifest_path: 'agent.json',
        source_manifest_hash: 'sha256:manifest',
        source_schemas_hash: 'sha256:schemas',
        source_contract_inputs_hash: 'sha256:inputs',
        contracts_index_hash: 'sha256:index',
        contracts_hash: 'sha256:contracts',
        contract_count: 1,
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    join(root, 'memory', 'contracts', 'index.json'),
    JSON.stringify(
      {
        type: 'agentpm-memory-contract-index',
        format_version: 1,
        contracts: [
          {
            space: 'profile',
            record_type: 'user_preference',
            schema_version: '1.0.0',
            model: 'document',
            source_schema: 'schemas/user-preference.schema.json',
            path: 'memory/contracts/profile.user_preference.schema.json',
            sha256: 'sha256:contract',
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(
    join(root, 'memory', 'contracts', 'profile.user_preference.schema.json'),
    JSON.stringify({ type: 'object' }, null, 2),
    'utf8',
  );
}

describe('agentpm node sdk - loadAgent', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agentpm-sdk-agent-test-'));
  const toolsDir = join(tmp, '.agentpm', 'tools');
  const agentsDir = join(tmp, '.agentpm', 'agents');
  const skillsDir = join(tmp, '.agentpm', 'skills');
  const knowledgeDir = join(tmp, '.agentpm', 'knowledge');
  const memoryDir = join(tmp, '.agentpm', 'memory');
  const lockfilePath = join(tmp, 'agent.lock');
  const agentSpec = '@zack/support-agent@0.1.0';
  const newerAgentSpec = '@zack/support-agent@0.2.0';

  beforeAll(() => {
    makeInstalledTool(toolsDir, '@zack/capitalize@0.1.0');
    makeInstalledSkill(skillsDir, '@zack/triage-skill@0.1.0');
    makeInstalledSkill(skillsDir, '@zack/triage-skill@0.2.0');
    makeInstalledKnowledge(knowledgeDir, '@zack/python-docs@0.1.0', 'vector');
    makeInstalledKnowledge(knowledgeDir, '@zack/support-playbook@0.1.0', 'context');
    makeInstalledMemory(memoryDir, '@zack/profile-memory@0.1.0');
    makeInstalledAgent(agentsDir, agentSpec, '@zack/triage-skill@0.1.0');
    makeInstalledAgent(agentsDir, newerAgentSpec, '@zack/triage-skill@0.2.0');
    writeFileSync(
      lockfilePath,
      JSON.stringify(
        {
          lockfile_version: 3,
          generated: '2026-05-23T00:00:00Z',
          packages: {
            'agent:@zack/support-agent@0.1.0': {
              kind: 'agent',
              name: '@zack/support-agent',
              version: '0.1.0',
              integrity: 'sha256-agent',
            },
            'agent:@zack/support-agent@0.2.0': {
              kind: 'agent',
              name: '@zack/support-agent',
              version: '0.2.0',
              integrity: 'sha256-agent-2',
            },
            'tool:@zack/capitalize@0.1.0': {
              kind: 'tool',
              name: '@zack/capitalize',
              version: '0.1.0',
              integrity: 'sha256-tool',
            },
            'skill:@zack/triage-skill@0.1.0': {
              kind: 'skill',
              name: '@zack/triage-skill',
              version: '0.1.0',
              integrity: 'sha256-skill',
            },
            'skill:@zack/triage-skill@0.2.0': {
              kind: 'skill',
              name: '@zack/triage-skill',
              version: '0.2.0',
              integrity: 'sha256-skill-2',
            },
            'knowledge:@zack/python-docs@0.1.0': {
              kind: 'knowledge',
              name: '@zack/python-docs',
              version: '0.1.0',
              integrity: 'sha256-knowledge',
            },
            'knowledge:@zack/support-playbook@0.1.0': {
              kind: 'knowledge',
              name: '@zack/support-playbook',
              version: '0.1.0',
              integrity: 'sha256-knowledge-context',
            },
            'memory:@zack/profile-memory@0.1.0': {
              kind: 'memory',
              name: '@zack/profile-memory',
              version: '0.1.0',
              integrity: 'sha256-memory',
            },
          },
          roots: {
            'agent:@zack/support-agent@0.1.0': {
              tools: ['tool:@zack/capitalize@0.1.0'],
              skills: ['skill:@zack/triage-skill@0.1.0'],
              knowledge: ['knowledge:@zack/python-docs@0.1.0'],
              memory: ['memory:@zack/profile-memory@0.1.0'],
              reserved: {
                knowledge: [],
                memory: [],
                profiles: [],
              },
            },
            'agent:@zack/support-agent@0.2.0': {
              tools: ['tool:@zack/capitalize@0.1.0'],
              skills: ['skill:@zack/triage-skill@0.2.0'],
              knowledge: ['knowledge:@zack/support-playbook@0.1.0'],
              reserved: {
                knowledge: [],
                memory: [],
                profiles: [],
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads an installed agent manifest and exposes resolved tools and skills from the lockfile', async () => {
    const loaded = await loadAgent(agentSpec, {
      agentDirOverride: agentsDir,
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
      knowledgeDirOverride: knowledgeDir,
      memoryDirOverride: memoryDir,
      lockfileOverride: lockfilePath,
    });

    expect(loaded.manifest.kind).toBe('agent');
    expect(loaded.manifest.name).toBe('support-agent');
    expect(loaded.root).toContain('.agentpm/agents');
    expect(loaded.resolvedTools).toEqual([
      {
        packageKey: 'tool:@zack/capitalize@0.1.0',
        kind: 'tool',
        name: '@zack/capitalize',
        version: '0.1.0',
        integrity: 'sha256-tool',
        root: expect.stringContaining('.agentpm/tools'),
        manifestPath: expect.stringContaining('.agentpm/tools'),
      },
    ]);
    expect(loaded.resolvedSkills).toEqual([
      {
        packageKey: 'skill:@zack/triage-skill@0.1.0',
        kind: 'skill',
        name: '@zack/triage-skill',
        version: '0.1.0',
        integrity: 'sha256-skill',
        root: expect.stringContaining('.agentpm/skills'),
        manifestPath: expect.stringContaining('.agentpm/skills'),
      },
    ]);
    expect(loaded.resolvedKnowledge).toEqual([
      {
        packageKey: 'knowledge:@zack/python-docs@0.1.0',
        kind: 'knowledge',
        name: '@zack/python-docs',
        version: '0.1.0',
        integrity: 'sha256-knowledge',
        mode: 'vector',
        root: expect.stringContaining('.agentpm/knowledge'),
        manifestPath: expect.stringContaining('.agentpm/knowledge'),
      },
    ]);
    expect(loaded.resolvedMemory).toEqual([
      {
        packageKey: 'memory:@zack/profile-memory@0.1.0',
        kind: 'memory',
        name: '@zack/profile-memory',
        version: '0.1.0',
        integrity: 'sha256-memory',
        root: expect.stringContaining('.agentpm/memory'),
        manifestPath: expect.stringContaining('.agentpm/memory'),
      },
    ]);
  });

  it('ignores legacy reserved.skills entries from older lockfile shapes', async () => {
    const legacyLockfilePath = join(tmp, 'agent-legacy.lock');
    writeFileSync(
      legacyLockfilePath,
      JSON.stringify(
        {
          lockfile_version: 2,
          generated: '2026-05-23T00:00:00Z',
          packages: {
            'agent:@zack/support-agent@0.1.0': {
              kind: 'agent',
              name: '@zack/support-agent',
              version: '0.1.0',
              integrity: 'sha256-agent',
            },
            'tool:@zack/capitalize@0.1.0': {
              kind: 'tool',
              name: '@zack/capitalize',
              version: '0.1.0',
              integrity: 'sha256-tool',
            },
          },
          roots: {
            'agent:@zack/support-agent@0.1.0': {
              tools: ['tool:@zack/capitalize@0.1.0'],
              reserved: {
                skills: ['skill:@zack/legacy-skill@0.1.0'],
                knowledge: [],
                memory: [],
                profiles: [],
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const loaded = await loadAgent(agentSpec, {
      agentDirOverride: agentsDir,
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
      knowledgeDirOverride: knowledgeDir,
      memoryDirOverride: memoryDir,
      lockfileOverride: legacyLockfilePath,
    });

    expect(loaded.reserved).toEqual({
      knowledge: [],
      memory: [],
      profiles: [],
    });
    expect('skills' in loaded.reserved).toBe(false);
    expect(loaded.resolvedSkills).toEqual([]);
    expect(loaded.resolvedKnowledge).toEqual([]);
    expect(loaded.resolvedMemory).toEqual([]);
  });

  it('resolves latest agent versions from the installed agents layout', async () => {
    const loaded = await loadAgent('@zack/support-agent@latest', {
      agentDirOverride: agentsDir,
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
      knowledgeDirOverride: knowledgeDir,
      memoryDirOverride: memoryDir,
      lockfileOverride: lockfilePath,
    });

    expect(loaded.manifest.version).toBe('0.2.0');
    expect(loaded.resolvedSkills[0]?.version).toBe('0.2.0');
  });

  it('resolves semver ranges for installed agents', async () => {
    const loaded = await loadAgent('@zack/support-agent@>=0.1.0 <0.3.0', {
      agentDirOverride: agentsDir,
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
      knowledgeDirOverride: knowledgeDir,
      memoryDirOverride: memoryDir,
      lockfileOverride: lockfilePath,
    });

    expect(loaded.manifest.version).toBe('0.2.0');
    expect(loaded.resolvedSkills[0]?.version).toBe('0.2.0');
  });

  it('keeps memory refs from the lockfile even when the installed package is missing on disk', async () => {
    const missingMemoryLockfilePath = join(tmp, 'agent-missing-memory.lock');
    writeFileSync(
      missingMemoryLockfilePath,
      JSON.stringify(
        {
          lockfile_version: 3,
          generated: '2026-05-23T00:00:00Z',
          packages: {
            'agent:@zack/support-agent@0.1.0': {
              kind: 'agent',
              name: '@zack/support-agent',
              version: '0.1.0',
              integrity: 'sha256-agent',
            },
            'memory:@zack/missing-memory@0.9.0': {
              kind: 'memory',
              name: '@zack/missing-memory',
              version: '0.9.0',
              integrity: 'sha256-missing-memory',
            },
          },
          roots: {
            'agent:@zack/support-agent@0.1.0': {
              memory: ['memory:@zack/missing-memory@0.9.0'],
              reserved: {
                knowledge: [],
                memory: [],
                profiles: [],
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const loaded = await loadAgent(agentSpec, {
      agentDirOverride: agentsDir,
      memoryDirOverride: memoryDir,
      lockfileOverride: missingMemoryLockfilePath,
    });

    expect(loaded.resolvedMemory).toEqual([
      {
        packageKey: 'memory:@zack/missing-memory@0.9.0',
        kind: 'memory',
        name: '@zack/missing-memory',
        version: '0.9.0',
        integrity: 'sha256-missing-memory',
        root: null,
        manifestPath: null,
      },
    ]);
  });

  it('fails with an actionable error when agent.lock is missing', async () => {
    await expect(
      loadAgent(agentSpec, {
        agentDirOverride: agentsDir,
        skillDirOverride: skillsDir,
        toolDirOverride: toolsDir,
        knowledgeDirOverride: knowledgeDir,
        memoryDirOverride: memoryDir,
        lockfileOverride: join(tmp, 'missing-agent.lock'),
      }),
    ).rejects.toThrow(/agentpm install/i);
  });

  it('fails with an actionable error when agent.lock is still v1', async () => {
    const v1LockfilePath = join(tmp, 'agent-v1.lock');
    writeFileSync(
      v1LockfilePath,
      JSON.stringify(
        {
          lockfile_version: 1,
          generated: '2026-05-23T00:00:00Z',
          dependencies: {},
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadAgent(agentSpec, {
        agentDirOverride: agentsDir,
        skillDirOverride: skillsDir,
        toolDirOverride: toolsDir,
        knowledgeDirOverride: knowledgeDir,
        memoryDirOverride: memoryDir,
        lockfileOverride: v1LockfilePath,
      }),
    ).rejects.toThrow(/agentpm install/i);
  });

  it('fails when the installed agent is missing from lockfile roots', async () => {
    const wrongRootLockfilePath = join(tmp, 'agent-missing-root.lock');
    writeFileSync(
      wrongRootLockfilePath,
      JSON.stringify(
        {
          lockfile_version: 3,
          generated: '2026-05-23T00:00:00Z',
          packages: {
            'agent:@zack/support-agent@0.1.0': {
              kind: 'agent',
              name: '@zack/support-agent',
              version: '0.1.0',
              integrity: 'sha256-agent',
            },
          },
          roots: {},
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadAgent(agentSpec, {
        agentDirOverride: agentsDir,
        skillDirOverride: skillsDir,
        toolDirOverride: toolsDir,
        knowledgeDirOverride: knowledgeDir,
        lockfileOverride: wrongRootLockfilePath,
      }),
    ).rejects.toThrow(/install the agent with agentpm install first/i);
  });

  it('returns tool metadata even when a resolved tool is missing on disk', async () => {
    const missingToolLockfilePath = join(tmp, 'agent-missing-tool.lock');
    writeFileSync(
      missingToolLockfilePath,
      JSON.stringify(
        {
          lockfile_version: 3,
          generated: '2026-05-23T00:00:00Z',
          packages: {
            'agent:@zack/support-agent@0.1.0': {
              kind: 'agent',
              name: '@zack/support-agent',
              version: '0.1.0',
              integrity: 'sha256-agent',
            },
            'tool:@zack/missing-tool@0.9.0': {
              kind: 'tool',
              name: '@zack/missing-tool',
              version: '0.9.0',
              integrity: 'sha256-missing-tool',
            },
          },
          roots: {
            'agent:@zack/support-agent@0.1.0': {
              tools: ['tool:@zack/missing-tool@0.9.0'],
              skills: [],
              reserved: {
                knowledge: [],
                memory: [],
                profiles: [],
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const loaded = await loadAgent(agentSpec, {
      agentDirOverride: agentsDir,
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
      knowledgeDirOverride: knowledgeDir,
      lockfileOverride: missingToolLockfilePath,
    });

    expect(loaded.resolvedTools).toEqual([
      {
        packageKey: 'tool:@zack/missing-tool@0.9.0',
        kind: 'tool',
        name: '@zack/missing-tool',
        version: '0.9.0',
        integrity: 'sha256-missing-tool',
        root: null,
        manifestPath: null,
      },
    ]);
  });

  it('returns knowledge metadata even when a resolved knowledge package is missing on disk', async () => {
    const missingKnowledgeLockfilePath = join(tmp, 'agent-missing-knowledge.lock');
    writeFileSync(
      missingKnowledgeLockfilePath,
      JSON.stringify(
        {
          lockfile_version: 3,
          generated: '2026-05-23T00:00:00Z',
          packages: {
            'agent:@zack/support-agent@0.1.0': {
              kind: 'agent',
              name: '@zack/support-agent',
              version: '0.1.0',
              integrity: 'sha256-agent',
            },
            'knowledge:@zack/missing-docs@0.9.0': {
              kind: 'knowledge',
              name: '@zack/missing-docs',
              version: '0.9.0',
              integrity: 'sha256-missing-knowledge',
            },
          },
          roots: {
            'agent:@zack/support-agent@0.1.0': {
              tools: [],
              skills: [],
              knowledge: ['knowledge:@zack/missing-docs@0.9.0'],
              reserved: {
                knowledge: [],
                memory: [],
                profiles: [],
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const loaded = await loadAgent(agentSpec, {
      agentDirOverride: agentsDir,
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
      knowledgeDirOverride: knowledgeDir,
      lockfileOverride: missingKnowledgeLockfilePath,
    });

    expect(loaded.resolvedKnowledge).toEqual([
      {
        packageKey: 'knowledge:@zack/missing-docs@0.9.0',
        kind: 'knowledge',
        name: '@zack/missing-docs',
        version: '0.9.0',
        integrity: 'sha256-missing-knowledge',
        mode: null,
        root: null,
        manifestPath: null,
      },
    ]);
  });
});
