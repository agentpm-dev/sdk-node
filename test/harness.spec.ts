import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  HarnessClient,
  HarnessProtocolError,
  serveKnowledgeRuntimeProcess,
  type AfterKnowledgeRetrievalHookHandler,
  type BeforeKnowledgeRequestHookHandler,
  type BeforeMemoryOperationHookHandler,
  type BeforeMemoryReadHookHandler,
  type BeforeMemoryWriteHookHandler,
  type KnowledgeProviderCapabilities,
  type KnowledgeRuntimeRequest,
} from '../src';

const protocol = 'agentpm-harness-machine';
const realHarnessCli = process.env.AGENTPM_HARNESS_CLI;
const realHarnessWorkspace = process.env.AGENTPM_HARNESS_WORKSPACE;
const realHarnessEmbeddingProvider = process.env.AGENTPM_HARNESS_EMBEDDING_PROVIDER ?? 'embedder';
const realHarnessEmbeddingSpaceProvider =
  process.env.AGENTPM_HARNESS_EMBEDDING_SPACE_PROVIDER ?? 'openai';
const realHarnessEmbeddingSpaceModel =
  process.env.AGENTPM_HARNESS_EMBEDDING_SPACE_MODEL ?? 'text-embedding-3-small';
const realHarnessEmbeddingDimensions = Number(
  process.env.AGENTPM_HARNESS_EMBEDDING_DIMENSIONS ?? '3',
);
const realHarnessEmbeddingNormalized = process.env.AGENTPM_HARNESS_EMBEDDING_NORMALIZED !== 'false';
const realHarnessKnowledgeRuntime = process.env.AGENTPM_HARNESS_KNOWLEDGE_RUNTIME ?? 'kb';
const realHarnessKnowledgePackage = process.env.AGENTPM_HARNESS_KNOWLEDGE_PACKAGE ?? '@zack/docs';
const realHarnessKnowledgeVersion = process.env.AGENTPM_HARNESS_KNOWLEDGE_VERSION ?? '0.1.0';
const realHarnessKnowledgeCorpus = process.env.AGENTPM_HARNESS_KNOWLEDGE_CORPUS;
const realHarnessEmbeddingKnowledgePackage =
  process.env.AGENTPM_HARNESS_EMBEDDING_KNOWLEDGE_PACKAGE ?? '@zack/local-vector';
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
        let modelUsage = null;
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
            modelUsage = frame.payload.usage;
            stage = 'hook';
            write({ kind: 'request', id: 'host-hook-1', method: 'host_service', payload: { role: 'hook', registry_id: 'sdk-hooks', method: 'before_tool_call', payload: { hook: 'before_tool_call', input: { arguments: { body: 'original' } } } } });
          } else if (frame.kind === 'response' && frame.id === 'host-hook-1') {
            stage = 'approval';
            write({ kind: 'request', id: 'host-approval-1', method: 'host_service', payload: { role: 'approval', registry_id: 'controller', method: 'request_approval', payload: { checkpoint: { id: 'gate' } } } });
          } else if (frame.kind === 'response' && frame.id === 'host-approval-1') {
            write({ kind: 'response', id: startRunId, payload: { status: 'ended', output: { stage, approval: frame.payload.decision, modelUsage }, report: {} } });
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
      output: {
        stage: 'approval',
        approval: 'approve',
        modelUsage: {
          model_calls: 0,
          tokens: {
            input_tokens: null,
            output_tokens: null,
            total_tokens: null,
          },
          accepted_semantic_actions: 0,
          tool_calls: 0,
          tool_retries: 0,
          knowledge_requests: 0,
          memory_requests: 0,
          embedding_requests: 0,
          duration_ms: null,
          cost: {
            amount: null,
            currency: null,
          },
        },
      },
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
    const beforeKnowledgeRequest: BeforeKnowledgeRequestHookHandler = () => ({
      decision: 'continue',
      patch: { query: 'narrowed', top_k: 2 },
    });
    const afterKnowledgeRetrieval: AfterKnowledgeRetrievalHookHandler = () => ({
      decision: 'continue',
      patch: {
        results: [{ source_id: 'src_1', chunk_id: 'chunk_1', text: 'model-visible text' }],
      },
    });
    const beforeMemoryRead: BeforeMemoryReadHookHandler = () => ({
      decision: 'continue',
      patch: { limit: 1 },
    });
    const beforeMemoryWrite: BeforeMemoryWriteHookHandler = (input) => ({
      decision: 'continue',
      patch: { content: input.content },
    });
    const beforeMemoryOperation: BeforeMemoryOperationHookHandler = () => ({
      decision: 'continue',
      patch: { model_guidance: 'Prefer recent records.' },
    });

    client
      .onBeforeToolCall(() => ({ decision: 'continue' }), { registryId: 'a' })
      .onBeforeModelRequest(() => ({ decision: 'continue' }), { registryId: 'b' })
      .onBeforeKnowledgeRequest(beforeKnowledgeRequest, { registryId: 'c' })
      .onAfterKnowledgeRetrieval(afterKnowledgeRetrieval, { registryId: 'd' })
      .onBeforeMemoryRead(beforeMemoryRead, { registryId: 'e' })
      .onBeforeMemoryWrite(beforeMemoryWrite, { registryId: 'f' })
      .onBeforeMemoryOperation(beforeMemoryOperation, { registryId: 'g' });

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
        {
          registry_id: 'c',
          hooks: ['before_knowledge_request'],
          capabilities: { hooks: ['before_knowledge_request'] },
        },
        {
          registry_id: 'd',
          hooks: ['after_knowledge_retrieval'],
          capabilities: { hooks: ['after_knowledge_retrieval'] },
        },
        {
          registry_id: 'e',
          hooks: ['before_memory_read'],
          capabilities: { hooks: ['before_memory_read'] },
        },
        {
          registry_id: 'f',
          hooks: ['before_memory_write'],
          capabilities: { hooks: ['before_memory_write'] },
        },
        {
          registry_id: 'g',
          hooks: ['before_memory_operation'],
          capabilities: { hooks: ['before_memory_operation'] },
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

  it('registers typed embedding and Knowledge providers and dispatches host requests', async () => {
    const script = makeFakeHarness(
      commonHarnessPrelude(`
        const registrations = [];
        let startRunId = null;
        rl.on('line', (line) => {
          const frame = JSON.parse(line);
          if (frame.method === 'initialize') {
            write({ kind: 'response', id: frame.id, payload: { session: { protocol, version: 1 }, preflight: { status: 'ready' }, required_host_services: [] } });
          } else if (frame.method === 'register_host_service') {
            registrations.push({
              role: frame.payload.role,
              registry_id: frame.payload.registry_id,
              capabilities: frame.payload.capabilities,
            });
            write({ kind: 'response', id: frame.id, payload: {
              registered: true,
              service: { role: frame.payload.role, registry_id: frame.payload.registry_id },
              active: true
            } });
          } else if (frame.method === 'start_run') {
            startRunId = frame.id;
            write({ kind: 'request', id: 'embed-1', method: 'host_service', payload: {
              role: 'embedding',
              registry_id: 'embedder',
              method: 'embed',
              payload: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 3, normalized: true, text: 'hello' }
            } });
          } else if (frame.kind === 'response' && frame.id === 'embed-1') {
            write({ kind: 'request', id: 'knowledge-1', method: 'host_service', payload: {
              role: 'knowledge',
              registry_id: 'kb',
              method: 'retrieve',
              payload: { request: { package: '@zack/docs', version: '0.1.0', mode: 'vector_query', query: 'hello', top_k: 1, return_citations: true } }
            } });
          } else if (frame.kind === 'response' && frame.id === 'knowledge-1') {
            write({ kind: 'response', id: startRunId, payload: {
              status: 'ended',
              output: { registrations, knowledge: frame.payload },
              report: {}
            } });
          }
        });
      `),
    );
    cleanup.push(resolve(script, '..'));
    const client = new HarnessClient({ agentpmPath: process.execPath, args: [script] });
    const calls: string[] = [];

    client
      .registerEmbeddingProvider(
        'embedder',
        (request) => {
          calls.push(`embedding:${request.provider}:${request.model}:${request.text}`);
          return {
            vector: [1, 0, 0],
            provider: request.provider,
            model: request.model,
            dimensions: 3,
          };
        },
        {
          embedding_spaces: [
            {
              provider: 'openai',
              model: 'text-embedding-3-small',
              dimensions: 3,
              normalized: true,
            },
          ],
        },
      )
      .registerKnowledgeRuntime(
        'kb',
        (request: KnowledgeRuntimeRequest) => {
          calls.push(`knowledge:${request.package}:${request.mode}:${request.query}`);
          return {
            ok: true,
            package: request.package,
            version: request.version,
            mode: request.mode,
            query: request.query,
            results: [
              {
                rank: 1,
                score: 0.9,
                chunk_id: 'chunk-1',
                source_id: 'source-1',
                text: 'answer',
              },
            ],
          };
        },
        {
          modes: ['vector_query'],
          features: ['citations'],
          packages: [{ package: '@zack/docs', version: '0.1.0', ready: true }],
        },
      );

    const result = await client.run('use typed knowledge providers');
    expect(calls).toEqual([
      'embedding:openai:text-embedding-3-small:hello',
      'knowledge:@zack/docs:vector_query:hello',
    ]);
    expect(result.output).toMatchObject({
      registrations: [
        { role: 'embedding', registry_id: 'embedder' },
        { role: 'knowledge', registry_id: 'kb' },
      ],
      knowledge: {
        ok: true,
        package: '@zack/docs',
        mode: 'vector_query',
      },
    });
    expect(client.hostServiceRegistration('embedding', 'embedder')).toMatchObject({ active: true });
    expect(client.hostServiceRegistration('knowledge', 'kb')).toMatchObject({ active: true });
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

  it('stores inactive host registration results with Harness-provided reasons', async () => {
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
              reason: 'configured KnowledgeRuntime could not attest the requested package'
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
      reason: 'configured KnowledgeRuntime could not attest the requested package',
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
    'runs a real agentpm harness process with host model, embedding, Knowledge, Hook, approval, and report',
    async () => {
      const client = new HarnessClient({
        agentpmPath: realHarnessCli,
        cwd: realHarnessWorkspace,
      });
      const calls: string[] = [];
      let modelCalls = 0;

      client
        .registerModelProvider('company-model', () => {
          calls.push('model');
          modelCalls += 1;
          if (modelCalls === 1) {
            return {
              assistant_content: null,
              actions: [
                {
                  id: 'sdk-real-cli-knowledge',
                  action: {
                    type: 'knowledge_request',
                    package: realHarnessKnowledgePackage,
                    mode: 'context_document',
                    document: 'knowledge/docs/overview.md',
                    return_citations: true,
                  },
                },
                {
                  id: 'sdk-real-cli-embedding',
                  action: {
                    type: 'knowledge_request',
                    package: realHarnessEmbeddingKnowledgePackage,
                    mode: 'vector_query',
                    query: 'real CLI SDK embedding query',
                    top_k: 1,
                    return_citations: true,
                  },
                },
              ],
              usage: {},
              finish_reason: 'tool_calls',
              provider_metadata: {},
            };
          }
          const outcome = modelCalls === 2 ? 'answer' : 'complete';
          return {
            assistant_content: null,
            actions: [
              {
                id: 'sdk-real-cli-complete',
                action: {
                  type: 'phase_completion',
                  outcome,
                  output: {
                    message: 'real CLI SDK host model response',
                  },
                },
              },
            ],
            usage: {},
            finish_reason: 'tool_calls',
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
      expect(info.required_host_services ?? []).toEqual(
        expect.arrayContaining([
          { role: 'embedding', registry_id: realHarnessEmbeddingProvider },
          { role: 'knowledge', registry_id: realHarnessKnowledgeRuntime },
        ]),
      );

      client
        .registerEmbeddingProvider(
          realHarnessEmbeddingProvider,
          (request) => {
            calls.push(`embedding:${request.provider}:${request.model}:${request.text}`);
            return {
              vector: Array.from({ length: request.dimensions }, (_, index) =>
                index === 0 ? 1 : 0,
              ),
              provider: request.provider,
              model: request.model,
              dimensions: request.dimensions,
              normalized: request.normalized,
            };
          },
          {
            embedding_spaces: [
              {
                provider: realHarnessEmbeddingSpaceProvider,
                model: realHarnessEmbeddingSpaceModel,
                dimensions: realHarnessEmbeddingDimensions,
                normalized: realHarnessEmbeddingNormalized,
              },
            ],
          },
        )
        .registerKnowledgeRuntime(
          realHarnessKnowledgeRuntime,
          (request: KnowledgeRuntimeRequest) => {
            calls.push(`knowledge:${request.package}:${request.mode}:${request.query ?? ''}`);
            return {
              ok: true,
              package: request.package,
              version: request.version,
              mode: request.mode,
              document: request.document,
              query: request.query,
              content: request.document ? 'real CLI SDK host Knowledge document' : undefined,
              results: request.query
                ? [
                    {
                      rank: 1,
                      score: 1,
                      chunk_id: 'sdk-real-cli-chunk',
                      source_id: 'sdk-real-cli-source',
                      text: 'real CLI SDK host Knowledge result',
                    },
                  ]
                : [],
              citations: request.return_citations
                ? [{ chunk_id: 'sdk-real-cli-chunk', source_id: 'sdk-real-cli-source' }]
                : [],
            };
          },
          {
            modes: ['context_document', 'vector_query'],
            features: ['citations'],
            packages: [
              {
                package: realHarnessKnowledgePackage,
                version: realHarnessKnowledgeVersion,
                ready: true,
                ...(realHarnessKnowledgeCorpus ? { corpus: realHarnessKnowledgeCorpus } : {}),
              },
            ],
          },
        );

      const result = await client.run('Run the SDK real CLI integration fixture.');
      expect(result.status).toBe('ended');
      expect(result.output).toBeDefined();
      expect(result.report).toBeDefined();
      expect(calls).toContain('model');
      expect(calls).toContain('before_model_request');
      expect(calls.some((call) => call.startsWith('knowledge:'))).toBe(true);
      expect(calls.some((call) => call.startsWith('embedding:'))).toBe(true);
      expect(
        client.hostServiceRegistration('embedding', realHarnessEmbeddingProvider),
      ).toMatchObject({
        active: true,
      });
      expect(
        client.hostServiceRegistration('knowledge', realHarnessKnowledgeRuntime),
      ).toMatchObject({
        active: true,
      });
      await client.shutdown();
    },
  );
});

describe('serveKnowledgeRuntimeProcess', () => {
  function collectOutput(): { stream: Writable; lines: () => unknown[] } {
    let output = '';
    return {
      stream: new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        },
      }),
      lines: () =>
        output
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown),
    };
  }

  const capabilities: KnowledgeProviderCapabilities = {
    modes: ['vector_query'],
    features: ['citations'],
    packages: [
      {
        package: '@zack/m13-reference-corpus',
        version: '0.1.0',
        corpus: 'sha256:corpus',
        ready: true,
      },
    ],
  };

  it('serves initialize and retrieve over agentpm-service JSONL', async () => {
    const input = new PassThrough();
    const output = collectOutput();
    const calls: KnowledgeRuntimeRequest[] = [];
    const served = serveKnowledgeRuntimeProcess(
      'pinecone-reference',
      async (request) => {
        calls.push(request);
        return {
          ok: true,
          package: request.package,
          version: request.version,
          mode: request.mode,
          query: request.query,
          results: [
            {
              rank: 1,
              score: 0.98,
              chunk_id: 'chunk-alpha',
              source_id: 'source-alpha',
              text: 'alpha result',
            },
          ],
          citations: [{ chunk_id: 'chunk-alpha', source_id: 'source-alpha' }],
        };
      },
      capabilities,
      { input, output: output.stream },
    );

    input.write(
      `${JSON.stringify({
        protocol: 'agentpm-service',
        version: 1,
        kind: 'initialize',
        id: 'init-1',
        service: 'knowledge',
        method: 'initialize',
        payload: { role: 'knowledge', registry_id: 'pinecone-reference' },
      })}\n`,
    );
    input.write(
      `${JSON.stringify({
        protocol: 'agentpm-service',
        version: 1,
        kind: 'request',
        id: 'req-1',
        service: 'knowledge',
        method: 'retrieve',
        payload: {
          request: {
            package: '@zack/m13-reference-corpus',
            version: '0.1.0',
            mode: 'vector_query',
            query: 'launch checklist',
            top_k: 1,
            return_citations: true,
          },
        },
      })}\n`,
    );
    input.end();

    await served;

    expect(calls).toEqual([
      {
        package: '@zack/m13-reference-corpus',
        version: '0.1.0',
        mode: 'vector_query',
        query: 'launch checklist',
        top_k: 1,
        return_citations: true,
      },
    ]);
    expect(output.lines()).toEqual([
      {
        protocol: 'agentpm-service',
        version: 1,
        kind: 'initialized',
        id: 'init-1',
        service: 'knowledge',
        result: {
          ...capabilities,
          registry_id: 'pinecone-reference',
          ready: true,
        },
      },
      {
        protocol: 'agentpm-service',
        version: 1,
        kind: 'response',
        id: 'req-1',
        service: 'knowledge',
        result: {
          ok: true,
          package: '@zack/m13-reference-corpus',
          version: '0.1.0',
          mode: 'vector_query',
          query: 'launch checklist',
          results: [
            {
              rank: 1,
              score: 0.98,
              chunk_id: 'chunk-alpha',
              source_id: 'source-alpha',
              text: 'alpha result',
            },
          ],
          citations: [{ chunk_id: 'chunk-alpha', source_id: 'source-alpha' }],
        },
      },
    ]);
  });

  it('returns service error frames for handler failures', async () => {
    const input = new PassThrough();
    const output = collectOutput();
    const served = serveKnowledgeRuntimeProcess(
      'pgvector-reference',
      () => {
        throw new Error('backend unavailable');
      },
      capabilities,
      { input, output: output.stream },
    );

    input.write(
      `${JSON.stringify({
        protocol: 'agentpm-service',
        version: 1,
        kind: 'request',
        id: 'req-err',
        service: 'knowledge',
        method: 'retrieve',
        payload: {
          package: '@zack/m13-reference-corpus',
          version: '0.1.0',
          mode: 'vector_query',
          query: 'launch checklist',
        },
      })}\n`,
    );
    input.end();

    await served;

    expect(output.lines()).toEqual([
      {
        protocol: 'agentpm-service',
        version: 1,
        kind: 'error',
        id: 'req-err',
        service: 'knowledge',
        error: {
          code: 'knowledge_runtime_error',
          message: 'backend unavailable',
          retryable: false,
        },
      },
    ]);
  });
});
