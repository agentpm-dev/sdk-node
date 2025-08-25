import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Import from source during dev. If you prefer, import from the package root.
import { JsonValue, load, ToolMeta } from '../src';
import { toLangChainTool } from '../src/adapters/langchain';

function makeToolPackage(baseDir: string, spec: string, command = 'node', scriptFile = 'tool.js') {
  // spec: "@scope/name@1.2.3"
  const atIdx = spec.lastIndexOf('@');
  if (atIdx <= 0 || atIdx === spec.length - 1) {
    throw new Error(`Bad spec: ${spec}`);
  }
  const name = spec.slice(0, atIdx); // "@scope/name"
  const version = spec.slice(atIdx + 1); // "1.2.3"

  const root = join(baseDir, `${name}@${version}`); // => base/@scope/name@1.2.3
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
    kind: 'tool',
  };
  writeFileSync(join(root, 'agent.json'), JSON.stringify(agentJson, null, 2), 'utf8');

  return { root, scriptFile, manifest: agentJson };
}

function makeFailingToolPackage(baseDir: string, spec: string) {
  const atIdx = spec.lastIndexOf('@');
  const name = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);

  const root = join(baseDir, `${name}@${version}`);
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
  const okSpec = '@zack/summarize@0.1.0';
  const bashCommandSpec = '@zack/scrape@0.1.0';
  const failSpec = '@zack/fail@0.1.0';

  beforeAll(() => {
    makeToolPackage(tmp, okSpec);
    makeToolPackage(tmp, bashCommandSpec, 'bash');
    makeFailingToolPackage(tmp, failSpec);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads a tool and invokes its entrypoint returning parsed JSON', async () => {
    const summarize = (await load(okSpec, {
      // Use the temp tool dir we created
      toolDirOverride: tmp,
    })) as (input: JsonValue) => Promise<JsonValue>;

    const result = await summarize({ text: 'hello world' });
    expect(result).toEqual({ summary: 'HELLO WORLD' });
  });

  it('throws a helpful error when unsupported entrypoint command is provided', async () => {
    await expect(load(bashCommandSpec, { toolDirOverride: tmp })).rejects.toThrow(
      /Unsupported agent\.json\.entrypoint\.command/,
    );
  });

  it('withMeta returns func + meta', async () => {
    const loaded = (await load(okSpec, {
      withMeta: true,
      toolDirOverride: tmp,
    })) as { func: (input: JsonValue) => Promise<JsonValue>; meta: ToolMeta };

    expect(typeof loaded.func).toBe('function');
    expect(loaded.meta.name).toBe('@zack/summarize');
    expect(loaded.meta.version).toBe('0.1.0');

    const out = (await loaded.func({ text: 'abc' })) as { [key: string]: JsonValue };
    expect(out['summary']).toBe('ABC');
  });

  it('toLangChainTool adapts (string in → string out) and includes rich description', async () => {
    const loaded = (await load(okSpec, {
      withMeta: true,
      toolDirOverride: tmp,
    })) as { func: (x: JsonValue) => Promise<JsonValue>; meta: ToolMeta };

    const lcTool = await toLangChainTool(loaded);

    expect(lcTool.name).toBe(loaded.meta.name);
    expect(typeof lcTool.description).toBe('string');
    expect(lcTool.description).toContain('Inputs:');
    expect(lcTool.description).toContain('Outputs:');

    const r = await lcTool.func({ text: 'mixed Case' });
    expect(r).toBe('MIXED CASE');
  });

  it('throws a helpful error when tool exits non-zero', async () => {
    const failing = (await load(failSpec, {
      toolDirOverride: tmp,
    })) as (input: JsonValue) => Promise<JsonValue>;

    await expect(failing({})).rejects.toThrow(/exited with code 2/i);
  });
});
