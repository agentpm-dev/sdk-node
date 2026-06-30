import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadSkill } from '../src';

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

function makeInstalledSkill(baseDir: string, spec: string, withTools = true) {
  const atIdx = spec.lastIndexOf('@');
  const packageName = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);
  const root = join(baseDir, `${packageName}/${version}`);
  const manifestName = packageName.slice(packageName.indexOf('/') + 1);
  mkdirSync(join(root, 'references'), { recursive: true });
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'SKILL.md'), '# Triage playbook\n\nUse the checklist.\n', 'utf8');
  writeFileSync(join(root, 'references', 'tool-contract.md'), 'contract\n', 'utf8');
  writeFileSync(join(root, 'scripts', 'run.sh'), '#!/bin/sh\necho ok\n', 'utf8');
  writeFileSync(
    join(root, 'agent.json'),
    JSON.stringify(
      {
        kind: 'skill',
        name: manifestName,
        version,
        description: 'Installed skill fixture',
        tools: withTools ? ['@zack/capitalize@0.1.0'] : [],
        skill: {
          entrypoint: 'SKILL.md',
          references: ['references/tool-contract.md'],
          scripts: ['scripts/run.sh'],
        },
      },
      null,
      2,
    ),
    'utf8',
  );
}

describe('agentpm node sdk - loadSkill', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agentpm-sdk-skill-test-'));
  const toolsDir = join(tmp, '.agentpm', 'tools');
  const skillsDir = join(tmp, '.agentpm', 'skills');
  const lockfilePath = join(tmp, 'agent.lock');

  beforeAll(() => {
    makeInstalledTool(toolsDir, '@zack/capitalize@0.1.0');
    makeInstalledSkill(skillsDir, '@zack/triage-playbook@0.1.0', true);
    makeInstalledSkill(skillsDir, '@zack/procedural-only@0.1.0', false);
    writeFileSync(
      lockfilePath,
      JSON.stringify(
        {
          lockfile_version: 3,
          generated: '2026-05-23T00:00:00Z',
          packages: {
            'skill:@zack/triage-playbook@0.1.0': {
              kind: 'skill',
              name: '@zack/triage-playbook',
              version: '0.1.0',
              integrity: 'sha256-skill',
            },
            'skill:@zack/procedural-only@0.1.0': {
              kind: 'skill',
              name: '@zack/procedural-only',
              version: '0.1.0',
              integrity: 'sha256-procedural',
            },
            'tool:@zack/capitalize@0.1.0': {
              kind: 'tool',
              name: '@zack/capitalize',
              version: '0.1.0',
              integrity: 'sha256-tool',
            },
          },
          roots: {
            'skill:@zack/triage-playbook@0.1.0': {
              tools: ['tool:@zack/capitalize@0.1.0'],
              reserved: {
                knowledge: [],
                memory: [],
                profiles: [],
              },
            },
            'skill:@zack/procedural-only@0.1.0': {
              tools: [],
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

  it('loads a procedural skill with no tools', async () => {
    const loaded = await loadSkill('@zack/procedural-only@0.1.0', {
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
      lockfileOverride: lockfilePath,
    });

    expect(loaded.kind).toBe('skill');
    expect(loaded.name).toBe('procedural-only');
    expect(loaded.entrypointContent).toContain('Triage playbook');
    expect(loaded.references).toEqual(['references/tool-contract.md']);
    expect(loaded.scripts).toEqual(['scripts/run.sh']);
    expect(loaded.resolvedTools).toEqual([]);
  });

  it('loads a tool-backed skill and exposes resolved tools', async () => {
    const loaded = await loadSkill('@zack/triage-playbook@0.1.0', {
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
      lockfileOverride: lockfilePath,
    });

    expect(loaded.entrypointPath).toContain('.agentpm/skills');
    expect(readFileSync(loaded.entrypointPath, 'utf8')).toContain('Use the checklist.');
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
  });

  it('falls back to manifest tools when the skill has no dedicated lock root', async () => {
    const rootlessLockfilePath = join(tmp, 'agent-owned-skill.lock');
    makeInstalledSkill(skillsDir, '@zack/triage-from-agent@0.1.0', true);
    writeFileSync(
      rootlessLockfilePath,
      JSON.stringify(
        {
          lockfile_version: 3,
          generated: '2026-06-29T00:00:00Z',
          packages: {
            'agent:@zack/ops-console@0.1.1': {
              kind: 'agent',
              name: '@zack/ops-console',
              version: '0.1.1',
              integrity: 'sha256-agent',
            },
            'skill:@zack/triage-from-agent@0.1.0': {
              kind: 'skill',
              name: '@zack/triage-from-agent',
              version: '0.1.0',
              integrity: 'sha256-skill',
            },
            'tool:@zack/capitalize@0.1.0': {
              kind: 'tool',
              name: '@zack/capitalize',
              version: '0.1.0',
              integrity: 'sha256-tool',
            },
          },
          roots: {
            'agent:@zack/ops-console@0.1.1': {
              skills: ['skill:@zack/triage-from-agent@0.1.0'],
              tools: [],
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const loaded = await loadSkill('@zack/triage-from-agent@0.1.0', {
      skillDirOverride: skillsDir,
      toolDirOverride: toolsDir,
      lockfileOverride: rootlessLockfilePath,
    });

    expect(loaded.kind).toBe('skill');
    expect(loaded.name).toBe('triage-from-agent');
    expect(loaded.entrypointContent).toContain('Use the checklist.');
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
  });
});
