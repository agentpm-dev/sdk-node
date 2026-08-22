import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadMemory, loadMemoryContract } from '../src';

function splitSpec(spec: string) {
  const atIdx = spec.lastIndexOf('@');
  return {
    packageName: spec.slice(0, atIdx),
    version: spec.slice(atIdx + 1),
  };
}

function writeInstalledMemory(baseDir: string, spec: string) {
  const { packageName, version } = splitSpec(spec);
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
              description: 'User preference record',
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
          operations: {
            refresh_profile: {
              type: 'transform',
              inputs: [{ space: 'profile', record_type: 'user_preference' }],
              output: { space: 'profile', record_type: 'user_preference' },
              output_mode: 'replace_input',
              source_handling: 'retain',
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
    JSON.stringify(
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { display_name: { type: 'string' } },
      },
      null,
      2,
    ),
    'utf8',
  );

  writeFileSync(
    join(root, 'memory', 'build.json'),
    JSON.stringify(
      {
        type: 'agentpm-memory-contracts',
        format_version: 1,
        built_at: '2026-07-20T00:00:00Z',
        agentpm_version: '0.1.0',
        manifest_path: 'agent.json',
        source_manifest_hash: 'sha256:manifest',
        source_schemas: [{ path: 'schemas/user-preference.schema.json', sha256: 'sha256:schema' }],
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
    JSON.stringify(
      {
        type: 'object',
        properties: {
          id: { type: 'string' },
          content: {
            type: 'object',
            properties: { display_name: { type: 'string' } },
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  return root;
}

describe('agentpm node sdk - loadMemory', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agentpm-sdk-memory-test-'));
  const memoryDir = join(tmp, '.agentpm', 'memory');

  beforeAll(() => {
    writeInstalledMemory(memoryDir, '@zack/profile-memory@0.1.0');
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads installed memory metadata, build metadata, contract index, and contract refs', async () => {
    const loaded = await loadMemory('@zack/profile-memory@0.1.0', {
      memoryDirOverride: memoryDir,
    });

    expect(loaded.kind).toBe('memory');
    expect(loaded.memory.spaces.profile.model).toBe('document');
    expect(loaded.memory.operations?.refresh_profile?.output_mode).toBe('replace_input');
    expect(loaded.build.type).toBe('agentpm-memory-contracts');
    expect(loaded.contractIndex.type).toBe('agentpm-memory-contract-index');
    expect(loaded.sourceSchemaPaths).toEqual([
      expect.stringContaining(
        '.agentpm/memory/@zack/profile-memory/0.1.0/schemas/user-preference.schema.json',
      ),
    ]);
    expect(loaded.contracts).toEqual([
      {
        space: 'profile',
        recordType: 'user_preference',
        schemaVersion: '1.0.0',
        model: 'document',
        sourceSchemaPath: expect.stringContaining(
          '.agentpm/memory/@zack/profile-memory/0.1.0/schemas/user-preference.schema.json',
        ),
        path: expect.stringContaining(
          '.agentpm/memory/@zack/profile-memory/0.1.0/memory/contracts/profile.user_preference.schema.json',
        ),
        sha256: 'sha256:contract',
      },
    ]);
  });

  it('loads one indexed contract on demand', async () => {
    const loaded = await loadMemory('@zack/profile-memory@0.1.0', {
      memoryDirOverride: memoryDir,
    });

    const contract = loadMemoryContract(loaded, {
      space: 'profile',
      recordType: 'user_preference',
    });
    expect(contract).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
  });

  it('fails with a clear error when the memory package is not installed', async () => {
    await expect(
      loadMemory('@zack/missing-memory@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/not found in \.agentpm\/memory/i);
  });

  it('fails when the installed manifest is not kind memory', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/not-memory@0.1.0');
    writeFileSync(
      join(root, 'agent.json'),
      JSON.stringify(
        {
          kind: 'tool',
          name: 'not-memory',
          version: '0.1.0',
          entrypoint: { command: 'node', args: ['tool.js'] },
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadMemory('@zack/not-memory@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/not a memory manifest/i);
  });

  it('fails when the installed memory manifest is missing memory metadata', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/missing-memory-object@0.1.0');
    writeFileSync(
      join(root, 'agent.json'),
      JSON.stringify(
        {
          kind: 'memory',
          name: 'missing-memory-object',
          version: '0.1.0',
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadMemory('@zack/missing-memory-object@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/missing memory object/i);
  });

  it('fails when the index points outside the installed package root via traversal', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/unsafe-memory@0.1.0');
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
              path: '../outside.schema.json',
              sha256: 'sha256:contract',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadMemory('@zack/unsafe-memory@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/safe package-relative path/i);
  });

  it('fails when memory/build.json is missing', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/missing-build@0.1.0');
    rmSync(join(root, 'memory', 'build.json'));

    await expect(
      loadMemory('@zack/missing-build@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/memory\/build\.json.*missing/i);
  });

  it('fails when memory/contracts/index.json is missing', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/missing-index@0.1.0');
    rmSync(join(root, 'memory', 'contracts', 'index.json'));

    await expect(
      loadMemory('@zack/missing-index@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/memory\/contracts\/index\.json.*missing/i);
  });

  it('fails when memory/build.json is malformed JSON', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/malformed-build@0.1.0');
    writeFileSync(join(root, 'memory', 'build.json'), '{not-json\n', 'utf8');

    await expect(
      loadMemory('@zack/malformed-build@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/memory\/build\.json is not valid JSON/i);
  });

  it('fails when memory/contracts/index.json is malformed JSON', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/malformed-index@0.1.0');
    writeFileSync(join(root, 'memory', 'contracts', 'index.json'), '{not-json\n', 'utf8');

    await expect(
      loadMemory('@zack/malformed-index@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/memory\/contracts\/index\.json is not valid JSON/i);
  });

  it('fails when memory/build.json is missing required hash fields', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/missing-hashes@0.1.0');
    writeFileSync(
      join(root, 'memory', 'build.json'),
      JSON.stringify(
        {
          type: 'agentpm-memory-contracts',
          format_version: 1,
          manifest_path: 'agent.json',
          source_manifest_hash: 'sha256:manifest',
          source_schemas_hash: 'sha256:schemas',
          contract_count: 1,
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadMemory('@zack/missing-hashes@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/missing source_contract_inputs_hash|missing contracts_hash/i);
  });

  it('fails when memory/build.json has unsupported type', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/unsupported-build-type@0.1.0');
    writeFileSync(
      join(root, 'memory', 'build.json'),
      JSON.stringify(
        {
          type: 'other-memory-build',
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

    await expect(
      loadMemory('@zack/unsupported-build-type@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/memory\/build\.json has unsupported type/i);
  });

  it('fails when memory/contracts/index.json has unsupported format_version', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/unsupported-index-format@0.1.0');
    writeFileSync(
      join(root, 'memory', 'contracts', 'index.json'),
      JSON.stringify(
        {
          type: 'agentpm-memory-contract-index',
          format_version: 2,
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

    await expect(
      loadMemory('@zack/unsupported-index-format@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/memory\/contracts\/index\.json has unsupported format_version/i);
  });

  it('fails when contract_count does not match index entries', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/count-mismatch@0.1.0');
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
          contract_count: 2,
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadMemory('@zack/count-mismatch@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/contract_count does not match/i);
  });

  it('fails when the index contains duplicate space and record type identities', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/duplicate-identity@0.1.0');
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
          contract_count: 2,
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
              sha256: 'sha256:contract-1',
            },
            {
              space: 'profile',
              record_type: 'user_preference',
              schema_version: '1.0.0',
              model: 'document',
              source_schema: 'schemas/user-preference.schema.json',
              path: 'memory/contracts/profile.user_preference.copy.schema.json',
              sha256: 'sha256:contract-2',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(root, 'memory', 'contracts', 'profile.user_preference.copy.schema.json'),
      JSON.stringify({ type: 'object' }, null, 2),
      'utf8',
    );

    await expect(
      loadMemory('@zack/duplicate-identity@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/duplicate contract entry/i);
  });

  it('fails when the index contains duplicate contract paths', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/duplicate-path@0.1.0');
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
          contract_count: 2,
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
              sha256: 'sha256:contract-1',
            },
            {
              space: 'archive',
              record_type: 'user_preference',
              schema_version: '1.0.0',
              model: 'document',
              source_schema: 'schemas/user-preference.schema.json',
              path: 'memory/contracts/profile.user_preference.schema.json',
              sha256: 'sha256:contract-2',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadMemory('@zack/duplicate-path@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/duplicate contract path/i);
  });

  it('fails when an indexed contract file is missing', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/missing-contract-file@0.1.0');
    rmSync(join(root, 'memory', 'contracts', 'profile.user_preference.schema.json'));

    await expect(
      loadMemory('@zack/missing-contract-file@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/contract path .* missing|memory\/contracts\/index\.json contract path/i);
  });

  it('fails when the index follows a symlink outside the installed package root', async () => {
    const root = writeInstalledMemory(memoryDir, '@zack/symlink-memory@0.1.0');
    const outsideDir = join(tmp, 'outside');
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(outsideDir, 'outside.schema.json'), '{}', 'utf8');
    rmSync(join(root, 'memory', 'contracts', 'profile.user_preference.schema.json'));
    symlinkSync(
      join(outsideDir, 'outside.schema.json'),
      join(root, 'memory', 'contracts', 'profile.user_preference.schema.json'),
    );

    await expect(
      loadMemory('@zack/symlink-memory@0.1.0', {
        memoryDirOverride: memoryDir,
      }),
    ).rejects.toThrow(/outside the installed memory package root/i);
  });

  it('fails when the requested indexed contract identity does not exist', async () => {
    const loaded = await loadMemory('@zack/profile-memory@0.1.0', {
      memoryDirOverride: memoryDir,
    });

    expect(() =>
      loadMemoryContract(loaded, {
        space: 'missing',
        recordType: 'user_preference',
      }),
    ).toThrow(/was not found/i);
  });
});
