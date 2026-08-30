import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HarnessClient, HarnessProtocolError } from '../src';

const protocol = 'agentpm-harness-machine';
const realHarnessCli = process.env.AGENTPM_HARNESS_CLI;
const realHarnessWorkspace = process.env.AGENTPM_HARNESS_WORKSPACE;
const hasRealHarnessFixture =
  !!realHarnessCli &&
  !!realHarnessWorkspace &&
  existsSync(realHarnessCli) &&
  existsSync(realHarnessWorkspace);

function makeFakeHarness(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentpm-node-harness-'));
  const script = join(dir, 'fake-harness.mjs');
  writeFileSync(script, source, 'utf8');
  return script;
}

function makeFakeAgentpmCommand(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentpm-node-harness-'));
  const script = join(dir, 'agentpm');
  writeFileSync(script, `#!/usr/bin/env node\n${source}`, 'utf8');
  chmodSync(script, 0o755);
  return script;
}

function commonHarnessPrelude(body: string): string {
  return `
    import readline from 'node:readline';
    const protocol = 'agentpm-harness-machine';
    const write = (frame) => process.stdout.write(JSON.stringify({ protocol, version: 1, ...frame }) + '\\n');
    const rl = readline.createInterface({ input: process.stdin });
    write({ kind: 'event', method: 'preflight', payload: { status: 'ready' } });
    ${body}
  `;
}

describe('HarnessClient', () => {
  const cleanup: string[] = [];

  afterEach(() => {
    for (const path of cleanup.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it('initializes, streams events, runs, and shuts down a machine Harness', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'preflight') {
            write({ kind: 'response', id: frame.id, payload: { status: 'ready_with_warnings', diagnostics: [] } });
          } else if (frame.method === 'start_run') {
            write({ kind: 'event', method: 'harness_event', payload: { event_type: 'run_started', payload: { fields: { input: frame.payload.input } } } });
            write({ kind: 'response', id: frame.id, payload: { status: 'ended', output: { message: 'done' }, report: { trace_path: 'events.jsonl' } } });
          } else if (frame.method === 'shutdown') {
            write({ kind: 'response', id: frame.id, payload: { shutdown: true } });
            process.exit(0);
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));

    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    const preflightEvent = await client.waitForEvent((event) => event.status === 'ready');
    expect(preflightEvent.status).toBe('ready');
    await expect(client.initialize()).resolves.toMatchObject({
      session: { protocol, version: 1 },
    });
    await expect(client.preflight()).resolves.toMatchObject({ status: 'ready_with_warnings' });
    await expect(client.run('hello')).resolves.toMatchObject({
      status: 'ended',
      output: { message: 'done' },
    });
    const runStarted = await client.waitForEvent((event) => event.event_type === 'run_started');
    expect(runStarted.payload).toEqual({ fields: { input: 'hello' } });
    await expect(client.shutdown()).resolves.toEqual({ shutdown: true });
  });

  it('passes installed Agent refs through as the harness positional selector', async () => {
    const command = makeFakeAgentpmCommand(`
      import readline from 'node:readline';
      const protocol = 'agentpm-harness-machine';
      const write = (frame) => process.stdout.write(JSON.stringify({ protocol, version: 1, ...frame }) + '\\n');
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', (line) => {
        const frame = JSON.parse(line);
        if (frame.method === 'initialize') {
          write({ kind: 'response', id: frame.id, payload: { argv: process.argv.slice(2), session: { protocol, version: 1 } } });
        }
      });
    `);
    cleanup.push(resolve(command, '..'));

    const client = new HarnessClient({
      agentpmPath: command,
      agent: '@zack/support-agent@0.1.0',
    });

    await expect(client.initialize()).resolves.toMatchObject({
      argv: ['harness', '@zack/support-agent@0.1.0', '--machine'],
    });
    client.stop();
  });

  it('iterates buffered and future events once in order', async () => {
    const script = makeFakeHarness(`
      const protocol = 'agentpm-harness-machine';
      const write = (frame) => process.stdout.write(JSON.stringify({ protocol, version: 1, ...frame }) + '\\n');
      write({ kind: 'event', method: 'harness_event', payload: { event_type: 'A' } });
      setTimeout(() => write({ kind: 'event', method: 'harness_event', payload: { event_type: 'B' } }), 20);
      setTimeout(() => process.exit(0), 60);
    `);
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    const iterator = client.eventsIterator()[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { event_type: 'A' },
      done: false,
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { event_type: 'B' },
      done: false,
    });
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it('routes host model, Hook, and approval requests through typed callbacks', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        let startRunId = null;
        let stage = 'model';
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'register_host_service') {
            write({ kind: 'response', id: frame.id, payload: { registered: true, service: { role: frame.payload.role, registry_id: frame.payload.registry_id } } });
          } else if (frame.method === 'start_run') {
            startRunId = frame.id;
            write({ kind: 'request', id: 'host-model-1', method: 'host_service', payload: { role: 'model', registry_id: 'company-model', method: 'generate', payload: { request: { phase_id: 'classify' } } } });
          } else if (frame.kind === 'response' && frame.id === 'host-model-1') {
            stage = 'hook';
            write({ kind: 'request', id: 'host-hook-1', method: 'host_service', payload: { role: 'hook', registry_id: 'sdk-hooks', method: 'before_tool_call', payload: { hook: 'before_tool_call', input: { arguments: { body: 'original' } } } } });
          } else if (frame.kind === 'response' && frame.id === 'host-hook-1') {
            stage = 'approval';
            write({ kind: 'request', id: 'host-approval-1', method: 'host_service', payload: { role: 'approval', registry_id: 'controller', method: 'request_approval', payload: { checkpoint: { id: 'gate' } } } });
          } else if (frame.kind === 'response' && frame.id === 'host-approval-1') {
            write({ kind: 'response', id: startRunId, payload: { status: 'ended', output: { stage, approval: frame.payload.decision }, report: {} } });
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const hostCalls: string[] = [];
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    client
      .registerModelProvider('company-model', (payload) => {
        hostCalls.push(`model:${JSON.stringify(payload)}`);
        return {
          assistant_content: null,
          actions: [],
          usage: {},
          finish_reason: 'stop',
          provider_metadata: {},
        };
      })
      .onBeforeToolCall((input) => {
        hostCalls.push(`hook:${JSON.stringify(input)}`);
        return { decision: 'continue', patch: { arguments: { body: 'patched' } } };
      })
      .onApproval((request) => {
        hostCalls.push(`approval:${JSON.stringify(request)}`);
        return 'approve';
      });

    const result = await client.run('use host services');
    expect(result).toMatchObject({
      status: 'ended',
      output: { stage: 'approval', approval: 'approve' },
    });
    expect(hostCalls).toHaveLength(3);
    client.stop();
  });

  it('maps host callback timeouts into host-service error frames', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        let startRunId = null;
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'register_host_service') {
            write({ kind: 'response', id: frame.id, payload: { registered: true } });
          } else if (frame.method === 'start_run') {
            startRunId = frame.id;
            write({ kind: 'request', id: 'host-hook-timeout', method: 'host_service', payload: { role: 'hook', registry_id: 'sdk-hooks', method: 'before_tool_call', payload: { input: { arguments: {} } } } });
          } else if (frame.kind === 'error' && frame.id === 'host-hook-timeout') {
            write({ kind: 'response', id: startRunId, payload: { status: 'ended', output: { code: frame.error.code }, report: {} } });
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    client.onBeforeToolCall(
      () => new Promise((resolve) => setTimeout(() => resolve({ decision: 'continue' }), 50)),
      { requestTimeoutMs: 5 },
    );

    await expect(client.run('timeout hook')).resolves.toMatchObject({
      output: { code: 'host_service_callback_failed' },
    });
    client.stop();
  });

  it('registers repeated Hook callbacks as ordered host bindings instead of merging locally', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        const registrations = [];
        let startRunId = null;
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'register_host_service') {
            registrations.push(frame.payload.registry_id);
            write({ kind: 'response', id: frame.id, payload: { registered: true } });
          } else if (frame.method === 'start_run') {
            startRunId = frame.id;
            write({ kind: 'request', id: 'hook-a', method: 'host_service', payload: { role: 'hook', registry_id: registrations[0], method: 'before_tool_selection', payload: { input: { candidates: [{ canonical_id: 't1' }, { canonical_id: 't2' }] } } } });
          } else if (frame.kind === 'response' && frame.id === 'hook-a') {
            write({ kind: 'request', id: 'hook-b', method: 'host_service', payload: { role: 'hook', registry_id: registrations[1], method: 'before_tool_selection', payload: { input: { candidates: [{ canonical_id: 't1' }] } } } });
          } else if (frame.kind === 'response' && frame.id === 'hook-b') {
            write({ kind: 'response', id: startRunId, payload: { status: 'ended', output: { registrations, second: frame.payload.patch.candidate_ids }, report: {} } });
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const seen: unknown[] = [];
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    client
      .onBeforeToolSelection(() => ({
        decision: 'continue',
        patch: { candidate_ids: ['t1'] },
      }))
      .onBeforeToolSelection((input) => {
        seen.push(input);
        return { decision: 'continue', patch: { candidate_ids: ['t1'] } };
      });

    const result = await client.run('compose hooks');
    expect(result.output).toEqual({
      registrations: ['sdk-hooks', 'sdk-hooks-1'],
      second: ['t1'],
    });
    expect(seen).toEqual([{ candidates: [{ canonical_id: 't1' }] }]);
    client.stop();
  });

  it('advertises only the Hook ID implemented by each explicit Hook registry', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        const registrations = [];
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'register_host_service') {
            registrations.push({
              registry_id: frame.payload.registry_id,
              hooks: frame.payload.hooks,
              capabilities: frame.payload.capabilities,
            });
            write({ kind: 'response', id: frame.id, payload: { registered: true } });
          } else if (frame.method === 'start_run') {
            write({ kind: 'response', id: frame.id, payload: { status: 'ended', output: { registrations }, report: {} } });
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    client
      .onBeforeToolCall(() => ({ decision: 'continue' }), { registryId: 'a' })
      .onBeforeModelRequest(() => ({ decision: 'continue' }), { registryId: 'b' });

    const result = await client.run('advertise hooks');
    expect(result.output).toEqual({
      registrations: [
        {
          registry_id: 'a',
          hooks: ['before_tool_call'],
          capabilities: { hooks: ['before_tool_call'] },
        },
        {
          registry_id: 'b',
          hooks: ['before_model_request'],
          capabilities: { hooks: ['before_model_request'] },
        },
      ],
    });
    client.stop();
  });

  it('advertises role-specific host service capabilities', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        const registrations = [];
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'register_host_service') {
            registrations.push({
              role: frame.payload.role,
              registry_id: frame.payload.registry_id,
              capabilities: frame.payload.capabilities,
              hooks: frame.payload.hooks,
            });
            write({ kind: 'response', id: frame.id, payload: { registered: true } });
          } else if (frame.method === 'start_run') {
            write({ kind: 'response', id: frame.id, payload: { status: 'ended', output: { registrations }, report: {} } });
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    client
      .registerModelProvider('company-model', () => ({}), {
        model: 'model-1',
        context_window_tokens: 4096,
      })
      .registerHostProvider('embedding', 'embedder', () => ({}), {
        embedding_spaces: [
          {
            provider: 'embedder',
            model: 'embed-1',
            dimensions: 1536,
            normalized: true,
          },
        ],
      })
      .onBeforeToolCall(() => ({ decision: 'continue' }), { registryId: 'hook-a' })
      .onApproval(() => 'approve', { cancellation: true });

    const result = await client.run('advertise capabilities');
    expect(result.output).toEqual({
      registrations: [
        {
          role: 'model',
          registry_id: 'company-model',
          capabilities: {
            provider: 'company-model',
            model: 'model-1',
            semantic_actions: true,
            structured_output: true,
            multimodal_input: false,
            context_window_tokens: 4096,
            usage_reporting: true,
          },
          hooks: [],
        },
        {
          role: 'embedding',
          registry_id: 'embedder',
          capabilities: {
            embedding_spaces: [
              {
                provider: 'embedder',
                model: 'embed-1',
                dimensions: 1536,
                normalized: true,
              },
            ],
          },
          hooks: [],
        },
        {
          role: 'hook',
          registry_id: 'hook-a',
          capabilities: { hooks: ['before_tool_call'] },
          hooks: ['before_tool_call'],
        },
        {
          role: 'approval',
          registry_id: 'controller',
          capabilities: { approval: true, cancellation: true },
          hooks: [],
        },
      ],
    });
    client.stop();
  });

  it('flushes host registrations added after initialize before the next run', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        const registrations = [];
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'register_host_service') {
            registrations.push(frame.payload.registry_id);
            write({ kind: 'response', id: frame.id, payload: { registered: true } });
          } else if (frame.method === 'start_run') {
            write({ kind: 'response', id: frame.id, payload: { status: 'ended', output: { registrations }, report: {} } });
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });

    await client.initialize();
    client.onBeforeToolCall(() => ({ decision: 'continue' }));

    await expect(client.run('late hook')).resolves.toMatchObject({
      output: { registrations: ['sdk-hooks'] },
    });
    client.stop();
  });

  it('stores inactive future-role host registration results', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'register_host_service') {
            write({ kind: 'response', id: frame.id, payload: {
              registered: true,
              service: { role: frame.payload.role, registry_id: frame.payload.registry_id },
              active: false,
              reason: 'KnowledgeRuntime host dispatch is reserved until Milestone 12'
            } });
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });

    client.registerHostProvider('knowledge', 'kb', () => ({ ok: true }));
    await client.initialize();

    expect(client.hostServiceRegistration('knowledge', 'kb')).toMatchObject({
      registered: true,
      service: { role: 'knowledge', registry_id: 'kb' },
      active: false,
      reason: 'KnowledgeRuntime host dispatch is reserved until Milestone 12',
    });
    expect(client.hostServiceRegistrations()).toHaveLength(1);
    client.stop();
  });

  it('maps cancellation and external Memory-operation control through machine requests', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'cancel_run') {
            write({ kind: 'response', id: frame.id, payload: { accepted: true, status: 'cancelled' } });
          } else if (frame.method === 'memory_operation') {
            write({ kind: 'error', id: frame.id, error: { code: 'memory_operation_unavailable', message: 'not live yet' } });
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    await client.initialize();
    await expect(client.cancelRun()).resolves.toEqual({ accepted: true, status: 'cancelled' });
    await expect(client.invokeMemoryOperation({ operation: 'compact' })).rejects.toMatchObject({
      code: 'memory_operation_unavailable',
    });
    client.stop();
  });

  it('rejects pending requests when the Harness process exits unexpectedly', async () => {
    const script = makeFakeHarness(`
      setTimeout(() => process.exit(7), 20);
    `);
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    await expect(client.initialize()).rejects.toThrow('Harness process exited');
  });

  it('marks the transport failed after malformed stdout and fails later requests fast', async () => {
    const script = makeFakeHarness(`
      import readline from 'node:readline';
      const rl = readline.createInterface({ input: process.stdin });
      rl.on('line', () => {
        process.stdout.write('not-json\\n');
      });
      setInterval(() => {}, 1000);
    `);
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });

    await expect(client.initialize()).rejects.toThrow();
    await expect(client.preflight()).rejects.toThrow();
  });

  it('exposes protocol errors with stable machine error codes', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          write({ kind: 'error', id: frame.id, error: { code: 'bad_version', message: 'nope' } });
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    await expect(client.initialize()).rejects.toBeInstanceOf(HarnessProtocolError);
  });

  it.skipIf(!hasRealHarnessFixture)(
    'runs a real agentpm harness process with host model, Hook, approval, and report',
    async () => {
      const client = new HarnessClient({
        agentpmPath: realHarnessCli,
        cwd: realHarnessWorkspace,
      });
      const calls: string[] = [];

      client
        .registerModelProvider('company-model', () => {
          calls.push('model');
          return {
            assistant_content: 'real CLI SDK host model response',
            actions: [],
            usage: {},
            finish_reason: 'stop',
            provider_metadata: {},
          };
        })
        .onBeforeModelRequest(() => {
          calls.push('before_model_request');
          return { decision: 'continue' };
        })
        .onBeforeToolCall(() => {
          calls.push('before_tool_call');
          return { decision: 'continue' };
        })
        .onApproval(() => {
          calls.push('approval');
          return 'approve';
        });

      const info = await client.initialize();
      expect(info.session).toMatchObject({ protocol, version: 1 });
      const result = await client.run('Run the SDK real CLI integration fixture.');
      expect(result.status).toBe('ended');
      expect(result.output).toBeDefined();
      expect(result.report).toBeDefined();
      expect(calls).toContain('model');
      expect(calls).toContain('before_model_request');
      await client.shutdown();
    },
  );
});
