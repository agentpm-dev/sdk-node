import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadKnowledge } from '../src';

function makeInstalledKnowledge(baseDir: string, spec: string, mode: 'context' | 'vector') {
  const atIdx = spec.lastIndexOf('@');
  const packageName = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);
  const root = join(baseDir, `${packageName}/${version}`);
  const manifestName = packageName.slice(packageName.indexOf('/') + 1);
  mkdirSync(root, { recursive: true });

  if (mode === 'context') {
    mkdirSync(join(root, 'knowledge', 'docs'), { recursive: true });
    writeFileSync(join(root, 'knowledge', 'docs', 'context.md'), '# Context\n', 'utf8');
  } else {
    mkdirSync(join(root, 'knowledge', 'indexes', 'default'), { recursive: true });
    writeFileSync(join(root, 'knowledge', 'chunks.jsonl'), '', 'utf8');
    writeFileSync(join(root, 'knowledge', 'sources.jsonl'), '', 'utf8');
    writeFileSync(join(root, 'knowledge', 'indexes', 'default', 'metadata.json'), '{}', 'utf8');
  }

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

describe('agentpm node sdk - loadKnowledge', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agentpm-sdk-knowledge-test-'));
  const knowledgeDir = join(tmp, '.agentpm', 'knowledge');

  beforeAll(() => {
    makeInstalledKnowledge(knowledgeDir, '@zack/support-playbook@0.1.0', 'context');
    makeInstalledKnowledge(knowledgeDir, '@zack/python-docs@0.1.0', 'vector');
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads installed context-mode knowledge metadata and resolved document paths', async () => {
    const loaded = await loadKnowledge('@zack/support-playbook@0.1.0', {
      knowledgeDirOverride: knowledgeDir,
    });

    expect(loaded.kind).toBe('knowledge');
    expect(loaded.knowledge.mode).toBe('context');
    expect(loaded.documentPaths).toEqual([
      expect.stringContaining(
        '.agentpm/knowledge/@zack/support-playbook/0.1.0/knowledge/docs/context.md',
      ),
    ]);
    expect(loaded.chunksPath).toBeNull();
    expect(loaded.indexPaths).toEqual([]);
  });

  it('loads installed vector-mode knowledge metadata and canonical paths', async () => {
    const loaded = await loadKnowledge('@zack/python-docs@0.1.0', {
      knowledgeDirOverride: knowledgeDir,
    });

    expect(loaded.kind).toBe('knowledge');
    expect(loaded.knowledge.mode).toBe('vector');
    expect(loaded.chunksPath).toContain('/knowledge/chunks.jsonl');
    expect(loaded.sourcesPath).toContain('/knowledge/sources.jsonl');
    expect(loaded.vectorsPath).toContain('/knowledge/embeddings/default.f32');
    expect(loaded.indexPaths).toEqual([expect.stringContaining('/knowledge/indexes/default')]);
  });

  it('fails with a clear error when the knowledge package is not installed', async () => {
    await expect(
      loadKnowledge('@zack/missing-docs@0.1.0', {
        knowledgeDirOverride: knowledgeDir,
      }),
    ).rejects.toThrow(/not found in \.agentpm\/knowledge/i);
  });

  it('fails when the installed manifest is not kind knowledge', async () => {
    const badSpec = '@zack/not-knowledge@0.1.0';
    const atIdx = badSpec.lastIndexOf('@');
    const packageName = badSpec.slice(0, atIdx);
    const version = badSpec.slice(atIdx + 1);
    const root = join(knowledgeDir, `${packageName}/${version}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'agent.json'),
      JSON.stringify(
        {
          kind: 'tool',
          name: 'not-knowledge',
          version,
          entrypoint: { command: 'node', args: ['tool.js'] },
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadKnowledge(badSpec, {
        knowledgeDirOverride: knowledgeDir,
      }),
    ).rejects.toThrow(/not a knowledge manifest/i);
  });

  it('fails when the installed knowledge manifest is missing knowledge.mode', async () => {
    const badSpec = '@zack/missing-mode@0.1.0';
    const atIdx = badSpec.lastIndexOf('@');
    const packageName = badSpec.slice(0, atIdx);
    const version = badSpec.slice(atIdx + 1);
    const root = join(knowledgeDir, `${packageName}/${version}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'agent.json'),
      JSON.stringify(
        {
          kind: 'knowledge',
          name: 'missing-mode',
          version,
          knowledge: {},
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadKnowledge(badSpec, {
        knowledgeDirOverride: knowledgeDir,
      }),
    ).rejects.toThrow(/missing knowledge\.mode/i);
  });
});
