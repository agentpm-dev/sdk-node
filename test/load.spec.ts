import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Import from source during dev. If you prefer, import from the package root.
import { JsonValue, load } from '../src';
import { toLangChainTool } from '../src/adapters/langchain';

function makeToolPackage(
  baseDir: string,
  spec: string,
  command = 'node',
  scriptFile = 'tool.js',
  withEnv = false,
) {
  // spec: "@scope/name@1.2.3"
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Bad spec: ${spec}`);
  }
  const name = spec.slice(0, atIdx); // "@scope/name"
  const version = spec.slice(atIdx + 1); // "1.2.3"

  const root = join(baseDir, `${name}/${version}`); // => base/@scope/name/1.2.3
  mkdirSync(root, { recursive: true });

  // Simple stdout "noise" + final JSON to test "last JSON" extraction
  const toolJs = `
    const fs = require('node:fs');
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    console.log('stdout noise before json');
    console.error('stderr debug line');
    const text = input.text || '';
    const out = { summary: text.toUpperCase() };
    process.stdout.write(JSON.stringify(out));
  `;
  writeFileSync(join(root, scriptFile), toolJs, 'utf8');

  const agentJson = {
    name,
    version,
    description: 'Test summarizer',
    inputs: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
    outputs: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
    entrypoint: { command, args: [scriptFile], cwd: '.', timeout_ms: 30000 },
    runtime: { type: 'node', version: '20' },
    kind: 'tool',
    environment: withEnv
      ? {
          vars: {
            OPENAI_API_KEY: {
              required: true,
              description: 'API key for OpenAI',
            },
            OPENAI_BASE_URL: {
              required: false,
              description: 'Custom API endpoint; defaults to https://api.openai.com/v1',
              default: 'https://api.openai.com/v1',
            },
          },
        }
      : undefined,
  };
  writeFileSync(join(root, 'agent.json'), JSON.stringify(agentJson, null, 2), 'utf8');

  return { root, scriptFile, manifest: agentJson };
}

function makeFailingToolPackage(baseDir: string, spec: string) {
  const atIdx = spec.lastIndexOf('@');
  const name = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);

  const root = join(baseDir, `${name}/${version}`);
  mkdirSync(root, { recursive: true });

  const toolJs = `
    process.stderr.write('boom');
    process.exit(2);
  `;
  writeFileSync(join(root, 'fail.js'), toolJs, 'utf8');

  const agentJson = {
    name,
    version,
    description: 'Always fails',
    inputs: { type: 'object', properties: {}, required: [] },
    outputs: { type: 'object', properties: {}, required: [] },
    entrypoint: { command: 'node', args: ['fail.js'], cwd: '.', timeout_ms: 30000 },
    kind: 'tool',
  };
  writeFileSync(join(root, 'agent.json'), JSON.stringify(agentJson, null, 2), 'utf8');

  return { root, manifest: agentJson };
}

describe('agentpm node sdk - load + toLangChainTool', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agentpm-sdk-test-'));
  const skillsDir = join(tmp, 'skills');
  const knowledgeDir = join(tmp, 'knowledge');
  const okSpec = '@zack/summarize@0.1.0';
  const bashCommandSpec = '@zack/scrape@0.1.0';
  const failSpec = '@zack/fail@0.1.0';
  const withEnvSpec = '@zack/with-env@0.1.0';
  const skillSpec = '@zack/triage-playbook@0.1.0';
  const knowledgeSpec = '@zack/python-docs@0.1.0';
  const memorySpec = '@zack/conversation-memory@0.1.0';
  const profileSpec = '@zack/support-style@0.1.0';
  const loopSpec = '@zack/incident-response-loop@0.1.0';

  beforeAll(() => {
    makeToolPackage(tmp, okSpec);
    makeToolPackage(tmp, bashCommandSpec, 'bash');
    makeFailingToolPackage(tmp, failSpec);
    makeToolPackage(tmp, withEnvSpec, undefined, undefined, true);
    const atIdx = skillSpec.lastIndexOf('@');
    const name = skillSpec.slice(0, atIdx);
    const version = skillSpec.slice(atIdx + 1);
    const root = join(skillsDir, `${name}/${version}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'agent.json'),
      JSON.stringify(
        {
          kind: 'skill',
          name,
          version,
          description: 'Skill fixture',
          tools: [],
          skill: {
            entrypoint: 'SKILL.md',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(join(root, 'SKILL.md'), '# Playbook\n', 'utf8');
    process.env.AGENTPM_SKILL_DIR = skillsDir;

    const knowledgeAtIdx = knowledgeSpec.lastIndexOf('@');
    const knowledgeName = knowledgeSpec.slice(0, knowledgeAtIdx);
    const knowledgeVersion = knowledgeSpec.slice(knowledgeAtIdx + 1);
    const knowledgeRoot = join(knowledgeDir, `${knowledgeName}/${knowledgeVersion}`);
    mkdirSync(knowledgeRoot, { recursive: true });
    writeFileSync(
      join(knowledgeRoot, 'agent.json'),
      JSON.stringify(
        {
          kind: 'knowledge',
          name: 'python-docs',
          version: knowledgeVersion,
          description: 'Knowledge fixture',
          knowledge: {
            mode: 'vector',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    process.env.AGENTPM_KNOWLEDGE_DIR = knowledgeDir;

    const memoryAtIdx = memorySpec.lastIndexOf('@');
    const memoryName = memorySpec.slice(0, memoryAtIdx);
    const memoryVersion = memorySpec.slice(memoryAtIdx + 1);
    const memoryRoot = join(tmp, 'memory', `${memoryName}/${memoryVersion}`);
    mkdirSync(join(memoryRoot, 'schemas'), { recursive: true });
    mkdirSync(join(memoryRoot, 'memory', 'contracts'), { recursive: true });
    writeFileSync(
      join(memoryRoot, 'agent.json'),
      JSON.stringify(
        {
          kind: 'memory',
          name: 'conversation-memory',
          version: memoryVersion,
          description: 'Memory fixture',
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
      join(memoryRoot, 'schemas', 'user-preference.schema.json'),
      JSON.stringify(
        {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            display_name: { type: 'string' },
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(memoryRoot, 'memory', 'build.json'),
      JSON.stringify(
        {
          type: 'agentpm-memory-contracts',
          format_version: 1,
          built_at: '2026-07-20T00:00:00Z',
          agentpm_version: '0.1.0',
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
      join(memoryRoot, 'memory', 'contracts', 'index.json'),
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
      join(memoryRoot, 'memory', 'contracts', 'profile.user_preference.schema.json'),
      JSON.stringify(
        {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'object' },
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    process.env.AGENTPM_MEMORY_DIR = join(tmp, 'memory');

    const profileAtIdx = profileSpec.lastIndexOf('@');
    const profileName = profileSpec.slice(0, profileAtIdx);
    const profileVersion = profileSpec.slice(profileAtIdx + 1);
    const profileRoot = join(tmp, 'profiles', `${profileName}/${profileVersion}`);
    mkdirSync(profileRoot, { recursive: true });
    writeFileSync(
      join(profileRoot, 'agent.json'),
      JSON.stringify(
        {
          kind: 'profile',
          name: 'support-style',
          version: profileVersion,
          description: 'Profile fixture',
          profile: {
            identity: { role: 'Support agent' },
            objectives: ['Help users move forward'],
            communication: {
              tone: ['calm'],
              verbosity: 'balanced',
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    process.env.AGENTPM_PROFILE_DIR = join(tmp, 'profiles');

    const loopAtIdx = loopSpec.lastIndexOf('@');
    const loopName = loopSpec.slice(0, loopAtIdx);
    const loopVersion = loopSpec.slice(loopAtIdx + 1);
    const loopRoot = join(tmp, 'loops', `${loopName}/${loopVersion}`);
    mkdirSync(loopRoot, { recursive: true });
    writeFileSync(
      join(loopRoot, 'agent.json'),
      JSON.stringify(
        {
          kind: 'loop',
          name: 'incident-response-loop',
          version: loopVersion,
          description: 'Loop fixture',
          loop: {
            entry_phase: 'assess',
            phases: [{ id: 'assess', objective: 'Assess the request.' }],
            transitions: [{ from: 'assess', on: 'complete', to: '$end' }],
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    process.env.AGENTPM_LOOP_DIR = join(tmp, 'loops');
  });

  afterAll(() => {
    delete process.env.AGENTPM_SKILL_DIR;
    delete process.env.AGENTPM_KNOWLEDGE_DIR;
    delete process.env.AGENTPM_MEMORY_DIR;
    delete process.env.AGENTPM_PROFILE_DIR;
    delete process.env.AGENTPM_LOOP_DIR;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads a tool and invokes its entrypoint returning parsed JSON', async () => {
    const summarize = await load(okSpec, {
      // Use the temp tool dir we created
      toolDirOverride: tmp,
    });

    const result = await summarize({ text: 'hello world' });
    expect(result).toEqual({ summary: 'HELLO WORLD' });
  });

  it('throws a helpful error when unsupported entrypoint command is provided', async () => {
    await expect(load(bashCommandSpec, { toolDirOverride: tmp })).rejects.toThrow(
      /Unsupported agent\.json\.entrypoint\.command/,
    );
  });

  it('withMeta returns func + meta', async () => {
    const loaded = await load(okSpec, {
      withMeta: true,
      toolDirOverride: tmp,
    });

    expect(typeof loaded.func).toBe('function');
    expect(loaded.meta.name).toBe('@zack/summarize');
    expect(loaded.meta.version).toBe('0.1.0');

    const out = (await loaded.func({ text: 'abc' })) as { [key: string]: JsonValue };
    expect(out['summary']).toBe('ABC');
  });

  it('withMeta returns func + meta with environment', async () => {
    const loaded = await load(withEnvSpec, {
      withMeta: true,
      toolDirOverride: tmp,
      env: {
        OPENAI_API_KEY: 'Zack',
      },
    });

    expect(typeof loaded.func).toBe('function');
    expect(loaded.meta.environment).toBeDefined();

    const out = (await loaded.func({ text: 'abc' })) as { [key: string]: JsonValue };
    expect(out['summary']).toBe('ABC');
  });

  it('toLangChainTool adapts (string in → string out) and includes rich description', async () => {
    const loaded = await load(okSpec, {
      withMeta: true,
      toolDirOverride: tmp,
    });

    const lcTool = await toLangChainTool(loaded);

    expect(lcTool.name).toBe(loaded.meta.name);
    expect(typeof lcTool.description).toBe('string');
    expect(lcTool.description).toContain('Inputs:');
    expect(lcTool.description).toContain('Outputs:');

    const r = await lcTool.func({ text: 'mixed Case' });
    expect(r).toBe('MIXED CASE');
  });

  it('throws a helpful error when tool exits non-zero', async () => {
    const failing = await load(failSpec, {
      toolDirOverride: tmp,
    });

    await expect(failing({})).rejects.toThrow(/exited with code 2/i);
  });

  it('throws a helpful error when required env variables are missing', async () => {
    await expect(
      load(withEnvSpec, {
        toolDirOverride: tmp,
      }),
    ).rejects.toThrow(/Missing environment variable: OPENAI_API_KEY/i);
  });

  it('rejects installed skill specs with guidance to use loadSkill', async () => {
    await expect(load(skillSpec, { toolDirOverride: tmp })).rejects.toThrow(/use loadSkill/i);
  });

  it('rejects installed knowledge specs with guidance to use loadKnowledge', async () => {
    await expect(load(knowledgeSpec, { toolDirOverride: tmp })).rejects.toThrow(
      /use loadKnowledge/i,
    );
  });

  it('rejects installed memory specs with guidance to use loadMemory', async () => {
    await expect(load(memorySpec, { toolDirOverride: tmp })).rejects.toThrow(/use loadMemory/i);
  });

  it('rejects installed profile specs with guidance to use loadProfile', async () => {
    await expect(load(profileSpec, { toolDirOverride: tmp })).rejects.toThrow(/use loadProfile/i);
  });

  it('rejects installed loop specs with guidance to use loadLoop', async () => {
    await expect(load(loopSpec, { toolDirOverride: tmp })).rejects.toThrow(/use loadLoop/i);
  });

  it('rejects uninstalled skill-like specs with guidance to use loadSkill', async () => {
    await expect(load('@zack/missing-skill@0.1.0', { toolDirOverride: tmp })).rejects.toThrow(
      /use loadSkill/i,
    );
  });

  it('rejects installed knowledge specs with guidance to use loadKnowledge', async () => {
    await expect(load(knowledgeSpec, { toolDirOverride: tmp })).rejects.toThrow(
      /use loadKnowledge/i,
    );
  });
});
