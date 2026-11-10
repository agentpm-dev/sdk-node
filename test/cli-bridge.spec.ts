import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { load, loadAgent, loadSkill } from '../src';
import { invoke } from '../src/cli';

vi.mock('node:child_process', async (original) => {
  const real = await original<typeof import('node:child_process')>();
  const translate = (command: string, args: readonly string[]) =>
    command === 'mock-agentpm'
      ? ([
          process.env.AGENTPM_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
          [join(process.cwd(), 'test/fixtures/sdk-v1/mock_cli.py'), ...args],
        ] as const)
      : ([command, args] as const);
  return {
    ...real,
    spawn: (
      command: string,
      args: readonly string[],
      options: import('node:child_process').SpawnOptions,
    ) => {
      const [cmd, argv] = translate(command, args);
      return real.spawn(cmd, argv, options);
    },
    spawnSync: (
      command: string,
      args: readonly string[],
      options: import('node:child_process').SpawnSyncOptions,
    ) => {
      const [cmd, argv] = translate(command, args);
      return real.spawnSync(cmd, argv, options);
    },
  };
});

const fixtures = join(import.meta.dirname, 'fixtures/sdk-v1');
const vectors = JSON.parse(readFileSync(join(fixtures, 'compatibility.json'), 'utf8')) as {
  valid: { name: string; lock: unknown }[];
  invalid: { name: string; lock: unknown }[];
  agent: string;
};
let project: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  project = realpathSync(mkdtempSync(join(tmpdir(), 'sdk bridge with spaces ')));
  vi.stubEnv('AGENTPM', 'mock-agentpm');
  vi.stubEnv('MOCK_CLI_CAPTURE', join(project, 'capture.json'));
});
afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
  rmSync(project, { recursive: true, force: true });
});

function writeAgent() {
  for (const [kind, name, version] of [
    ['agent', 'agent', '0.1.7'],
    ['agent', 'agent', '0.1.6'],
    ['skill', 'skill', '1.0.0'],
    ['tool', 'tool', '0.1.9'],
    ['tool', 'tool', '0.1.8'],
  ]) {
    const directory = join(project, `.agentpm/${kind}s/fixture/${name}/${version}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'agent.json'),
      JSON.stringify({
        kind,
        name,
        version,
        tools: ['@fixture/tool@0.1.9'],
        skill: { entrypoint: 'SKILL.md' },
        entrypoint: { command: 'node', args: ['tool.js'], env: { LAYER: 'manifest' } },
      }),
    );
    writeFileSync(join(directory, 'SKILL.md'), '# Shared fixture');
  }
}

describe('CLI delegation', () => {
  it('preserves public shapes, exact selected directory, stdin and caller env without rewriting lock', async () => {
    writeAgent();
    const lock = join(project, 'agent.lock');
    writeFileSync(lock, JSON.stringify(vectors.valid[2]!.lock));
    const before = readFileSync(lock);
    // Loading captures the project; subsequent cwd changes cannot move execution.
    process.chdir(project);
    vi.stubEnv('LAYER', 'ambient');
    const loaded = await load('@fixture/tool@^0.1.0', {
      withMeta: true,
      env: { LAYER: 'caller', MOCK_SECRET_TOKEN: 'sdk-secret-token' },
    });
    process.chdir(originalCwd);
    const payload = { message: 'quotes " unicode 😀', nested: [1, false] };
    expect(await loaded.func(payload)).toEqual(payload);
    const capture = JSON.parse(readFileSync(join(project, 'capture.json'), 'utf8'));
    expect(capture.argv).toEqual([
      'run',
      '@fixture/tool@0.1.9',
      '--machine',
      '--sdk-request',
      '--timeout-ms',
      '120000',
    ]);
    expect(capture.cwd).toBe(project);
    expect(capture.request.tool_directory).toBe(join(project, '.agentpm/tools/fixture/tool/0.1.9'));
    expect(capture.request.input).toEqual(payload);
    expect(capture.request.environment.LAYER).toBe('caller');
    expect(JSON.stringify(capture.argv)).not.toContain('sdk-secret-token');
    expect(await loaded.func({ case: 'tool-error' })).toEqual({
      ok: false,
      error: 'Tool business error',
    });
    expect(readFileSync(lock)).toEqual(before);
  });

  it.each(['malformed', 'incomplete', 'wrong-schema', 'wrong-tool', 'nonzero', 'huge'])(
    'rejects %s transport response',
    async (kind) => {
      await expect(
        invoke(project, project, '@fixture/tool@0.1.9', { case: kind }, 1000, {}),
      ).rejects.toThrow(/AgentPM CLI/);
      if (kind === 'wrong-tool') {
        await expect(
          invoke(project, project, '@fixture/tool@0.1.9', { case: 'wrong-tool-type' }, 1000, {}),
        ).rejects.toThrow(/AgentPM CLI/);
      }
    },
  );

  it.each(['error', 'timeout'])('redacts %s errors and stderr', async (kind) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      await expect(
        invoke(project, project, '@fixture/tool@0.1.9', { case: kind }, 1000, {
          MOCK_SECRET_TOKEN: 'fixture-secret-token',
        }),
      ).rejects.toThrow('run agentpm install again [REDACTED]');
      expect(JSON.stringify(stderr.mock.calls)).not.toContain('fixture-secret-token');
    } finally {
      stderr.mockRestore();
    }
  });

  it.each(['agentpm 0.1.42', 'agentpm 0.1.43-beta.1', 'garbage'])(
    'rejects incompatible CLI %s',
    async (version) => {
      vi.stubEnv('MOCK_CLI_VERSION', version);
      await expect(invoke(project, project, '@fixture/tool@0.1.9', {}, 1000, {})).rejects.toThrow(
        'Install AgentPM CLI >=0.1.43',
      );
      expect(existsSync(join(project, 'capture.json'))).toBe(false);
    },
  );

  it('rejects a missing CLI and invalid timeouts', async () => {
    vi.stubEnv('AGENTPM', join(project, 'missing'));
    await expect(invoke(project, project, '@fixture/tool@0.1.9', {}, 1000, {})).rejects.toThrow(
      'Install AgentPM CLI',
    );
    for (const timeout of [0, -1, NaN, Infinity, 1.5])
      await expect(
        invoke(project, project, '@fixture/tool@0.1.9', {}, timeout, {}),
      ).rejects.toThrow('timeout');
  });
});

it.each(vectors.valid)(
  'loads shared $name lock read-only with exact refs and no app manifest',
  async (vector) => {
    writeAgent();
    const lock = join(project, 'agent.lock');
    writeFileSync(lock, JSON.stringify(vector.lock));
    const before = readFileSync(lock);
    process.chdir(project);
    const agent = await loadAgent(vectors.agent);
    expect(agent.manifest.version).toBe('0.1.7');
    expect(agent.resolvedTools[0]!.version).toBe('0.1.9');
    expect(agent.resolvedSkills).toHaveLength(1);
    expect(agent.resolvedKnowledge).toHaveLength(1);
    expect(agent.resolvedMemory).toHaveLength(1);
    expect(agent.resolvedProfiles).toHaveLength(1);
    expect(agent.resolvedLoop?.version).toBe('1.0.0');
    const skill = await loadSkill('@fixture/skill@1.0.0');
    expect(skill.resolvedTools[0]!.version).toBe('0.1.9');
    expect(readFileSync(lock)).toEqual(before);
    expect(existsSync(join(project, 'agent.json'))).toBe(false);
    await expect(loadAgent('@fixture/local-author@1.0.0')).rejects.toThrow();
  },
);

it.each(vectors.invalid)(
  'rejects shared $name malformed/future lock without rewrite',
  async (vector) => {
    writeAgent();
    const lock = join(project, 'agent.lock');
    writeFileSync(lock, JSON.stringify(vector.lock));
    const before = readFileSync(lock);
    process.chdir(project);
    await expect(loadAgent(vectors.agent)).rejects.toThrow(/lock/);
    expect(readFileSync(lock)).toEqual(before);
  },
);

it('rejects a changed selected manifest version before invocation', async () => {
  writeAgent();
  const manifest = join(project, '.agentpm/tools/fixture/tool/0.1.9/agent.json');
  const value = JSON.parse(readFileSync(manifest, 'utf8'));
  value.version = '0.1.8';
  writeFileSync(manifest, JSON.stringify(value));
  process.chdir(project);
  await expect(load('@fixture/tool@0.1.9')).rejects.toThrow('version mismatch');
  expect(existsSync(join(project, 'capture.json'))).toBe(false);
});
