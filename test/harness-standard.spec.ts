import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { HarnessClient, HarnessProtocolError, type HarnessJsonValue } from '../src';

const cli = process.env.AGENTPM_TEST_CLI;
const standard = { id: 'agentpm', version: '1.0.0' };

it.each([undefined, [], [standard], null, [{ id: 'agentpm' }], 'malformed-report'])(
  'preserves absent/empty support and rejects malformed advertisement: %j',
  async (advertisement) => {
    const root = mkdtempSync(join(tmpdir(), 'sdk standard transport '));
    const script = join(root, 'cli.mjs');
    const report = {
      status: 'ready',
      ...(advertisement === undefined || advertisement === 'malformed-report'
        ? {}
        : { supported_standards: advertisement }),
      ...(advertisement === 'malformed-report' ? { report: null } : {}),
      future_field: { preserved: true },
    };
    writeFileSync(
      script,
      `import readline from 'node:readline';
      const report = ${JSON.stringify(report)};
      readline.createInterface({ input: process.stdin }).on('line', (line) => {
        const frame = JSON.parse(line);
        const payload = frame.method === 'initialize' ? {session:{protocol:frame.protocol,version:1},preflight:report} : frame.method === 'shutdown' ? {shutdown:true} : report;
        console.log(JSON.stringify({protocol:frame.protocol,version:1,kind:'response',id:frame.id,payload}));
        if (frame.method === 'shutdown') process.exit(0);
      });`,
    );
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    try {
      expect((await client.initialize()).preflight).toEqual(report);
      expect(await client.preflight()).toEqual(report);
      if (
        advertisement === null ||
        advertisement === 'malformed-report' ||
        (Array.isArray(advertisement) && advertisement.length && !('version' in advertisement[0]!))
      ) {
        await expect(client.supportedStandards()).rejects.toBeInstanceOf(HarnessProtocolError);
      } else expect(await client.supportedStandards()).toEqual(advertisement);
      await client.shutdown();
    } finally {
      client.stop();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  },
);

it.skipIf(!cli).each(['ready', 'no-loop', 'missing-model', 'legacy', 'unsupported'])(
  'agrees with real CLI standalone preflight and preserves machine inspection: %s',
  async (mode) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'sdk standard real ')));
    const setup = spawnSync(
      process.env.AGENTPM_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      [join(import.meta.dirname, 'fixtures/sdk-v1/harness_fixture.py'), root, cli!, mode],
      { encoding: 'utf8', env: { ...process.env, AGENTPM_TELEMETRY: '0' } },
    );
    expect(setup.status, setup.stderr).toBe(0);
    const expected = JSON.parse(readFileSync(join(root, 'expected-preflight.json'), 'utf8'));
    const client = new HarnessClient({
      agentpmPath: cli,
      cwd: root,
      env: { AGENTPM_TELEMETRY: '0' },
    });
    try {
      const info = await client.initialize();
      expect(info.session).toEqual({ protocol: 'agentpm-harness-machine', version: 1 });
      expect(info.preflight).toEqual(expected);
      expect((await client.preflight()).report).toEqual(expected);
      expect(await client.supportedStandards()).toEqual([standard]);
      if (!['ready', 'legacy'].includes(mode))
        await expect(client.run('must not run')).rejects.toMatchObject({
          code: 'preflight_not_ready',
        });
      await client.shutdown();
    } finally {
      client.stop();
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  },
);

it.skipIf(!cli)(
  'executes each Agent’s exact direct and Skill-inherited version and honors Loop denial',
  async () => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'sdk exact versions ')));
    const setup = spawnSync(
      process.env.AGENTPM_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      [join(import.meta.dirname, 'fixtures/sdk-v1/harness_fixture.py'), root, cli!, 'versions'],
      { encoding: 'utf8', env: { ...process.env, AGENTPM_TELEMETRY: '0' } },
    );
    expect(setup.status, setup.stderr).toBe(0);
    try {
      for (const major of [1, 2]) {
        const version = `${major}.0.0`;
        let calls = 0;
        const client = new HarnessClient({
          agentpmPath: cli,
          cwd: root,
          agent: `consumer-${major}`,
          env: { AGENTPM_TELEMETRY: '0' },
        });
        client.registerModelProvider('sdk-model', (payload) => {
          const request = (
            payload as {
              request: {
                phase_id: string;
                runtime: {
                  tools: { version: string }[];
                  skills: { version: string }[];
                  knowledge: { version: string }[];
                  profiles: { version: string }[];
                  loop_package: { version: string };
                  memory_operations: { package_version: string }[];
                };
                effective_phase: {
                  active_tools: { version: string }[];
                  active_skills: { version: string }[];
                  active_memory: unknown[];
                  active_memory_operations: { package_version: string }[];
                };
              };
            }
          ).request;
          expect(request.runtime.tools.map((p) => p.version)).toEqual([version]);
          expect(request.runtime.skills.map((p) => p.version)).toEqual([version]);
          expect(request.runtime.knowledge.map((p) => p.version)).toEqual([version]);
          expect(request.runtime.profiles.map((p) => p.version)).toEqual([version]);
          expect(request.runtime.loop_package.version).toBe(version);
          expect(request.runtime.memory_operations.map((p) => p.package_version)).toEqual([
            version,
          ]);
          expect(request.effective_phase.active_memory).toEqual([]);
          expect(
            request.effective_phase.active_memory_operations.map((p) => p.package_version),
          ).toEqual([version]);
          expect(request.effective_phase.active_skills.map((p) => p.version)).toEqual([version]);
          expect(request.effective_phase.active_tools.map((p) => p.version)).toEqual(
            request.phase_id === 'work' ? [version] : [],
          );
          calls++;
          const action: HarnessJsonValue =
            calls === 1
              ? { type: 'agent_pm_tool', tool: '@fixture/echo', arguments: {} }
              : { type: 'phase_completion', output: { version } };
          return {
            assistant_content: null,
            actions: [{ id: `step-${calls}`, action }],
            finish_reason: 'tool_calls',
          };
        });
        try {
          const initialized = await client.initialize();
          expect(initialized.preflight, JSON.stringify(initialized.preflight)).toMatchObject({
            local_readiness: 'ready',
          });
          const result = await client.run('Check exact versions.');
          expect(result.status, JSON.stringify(result)).toBe('ended');
          expect(calls).toBe(3);
          await client.shutdown();
        } finally {
          client.stop();
        }
      }
      expect(existsSync(join(root, 'skill-script-ran'))).toBe(false);
      expect(
        readFileSync(join(root, 'tool-runs.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      ).toEqual([{ version: '1.0.0' }, { version: '2.0.0' }]);
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  },
  30000,
);
