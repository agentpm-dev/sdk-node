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

describe('agentpm node sdk - loadAgent', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agentpm-sdk-agent-test-'));
  const toolsDir = join(tmp, '.agentpm', 'tools');
  const agentsDir = join(tmp, '.agentpm', 'agents');
  const skillsDir = join(tmp, '.agentpm', 'skills');
  const lockfilePath = join(tmp, 'agent.lock');
  const agentSpec = '@zack/support-agent@0.1.0';
  const newerAgentSpec = '@zack/support-agent@0.2.0';

  beforeAll(() => {
    makeInstalledTool(toolsDir, '@zack/capitalize@0.1.0');
    makeInstalledSkill(skillsDir, '@zack/triage-skill@0.1.0');
    makeInstalledSkill(skillsDir, '@zack/triage-skill@0.2.0');
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
          },
          roots: {
            'agent:@zack/support-agent@0.1.0': {
              tools: ['tool:@zack/capitalize@0.1.0'],
              skills: ['skill:@zack/triage-skill@0.1.0'],
              reserved: {
                knowledge: [],
                memory: [],
                profiles: [],
              },
            },
            'agent:@zack/support-agent@0.2.0': {
              tools: ['tool:@zack/capitalize@0.1.0'],
              skills: ['skill:@zack/triage-skill@0.2.0'],
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
      lockfileOverride: lockfilePath,
    });

    expect(loaded.manifest.kind).toBe('agent');
    expect(loaded.manifest.name).toBe('support-agent');
    expect(loaded.root).toContain('.agentpm/agents');
    expect(loaded.reserved.skills).toEqual([]);
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
  });

  it('resolves latest agent versions from the installed agents layout', async () => {
    const loaded = await loadAgent('@zack/support-agent@latest', {
      agentDirOverride: agentsDir,
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
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
      lockfileOverride: lockfilePath,
    });

    expect(loaded.manifest.version).toBe('0.2.0');
    expect(loaded.resolvedSkills[0]?.version).toBe('0.2.0');
  });

  it('fails with an actionable error when agent.lock is missing', async () => {
    await expect(
      loadAgent(agentSpec, {
        agentDirOverride: agentsDir,
        skillDirOverride: skillsDir,
        toolDirOverride: toolsDir,
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
});
