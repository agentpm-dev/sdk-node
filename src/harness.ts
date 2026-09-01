import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

export type HarnessJsonPrimitive = string | number | boolean | null;
export type HarnessJsonValue =
  | HarnessJsonPrimitive
  | { [key: string]: HarnessJsonValue }
  | HarnessJsonValue[];

export type HarnessFrameKind = 'request' | 'response' | 'event' | 'error';
export type HarnessHookId =
  | 'before_model_request'
  | 'before_tool_selection'
  | 'before_tool_call'
  | 'before_knowledge_request'
  | 'after_knowledge_retrieval'
  | 'before_memory_read'
  | 'before_memory_write'
  | 'before_memory_operation';

export type HarnessServiceRole =
  | 'model'
  | 'embedding'
  | 'hook'
  | 'knowledge'
  | 'memory'
  | 'approval';

export type HarnessMachineFrame = {
  protocol: 'agentpm-harness-machine';
  version: 1;
  kind: HarnessFrameKind;
  id?: string;
  method?: string;
  payload?: HarnessJsonValue;
  error?: HarnessMachineError;
};

export type HarnessMachineError = {
  code: string;
  message: string;
};

export type HarnessEvent = {
  event_type?: string;
  payload?: HarnessJsonValue;
  [key: string]: HarnessJsonValue | undefined;
};

export type HarnessPreflightResult = {
  status?: string;
  [key: string]: HarnessJsonValue | undefined;
};

export type HarnessRunResult = {
  status: string;
  output?: HarnessJsonValue;
  report?: HarnessJsonValue;
};

export type HarnessSessionInfo = {
  session?: HarnessJsonValue;
  preflight?: HarnessPreflightResult;
  required_host_services?: HostServiceRegistration[];
  [key: string]: unknown;
};

export type HostServiceRegistration = {
  role: HarnessServiceRole;
  registry_id: string;
};

export type HostServiceRegistrationResult = {
  registered: boolean;
  service: HostServiceRegistration;
  active: boolean;
  reason?: string | null;
  [key: string]: unknown;
};

export type HarnessClientOptions = {
  agentpmPath?: string;
  args?: string[];
  /**
   * Agent selector passed to `agentpm harness`.
   *
   * This may be a local Agent manifest path, such as `./agent.json`, or an
   * installed Agent package ref, such as `@scope/name@1.2.3`. Omit it to use
   * Harness workspace discovery/default Agent selection.
   */
  agent?: string;
  configPath?: string;
  stateDir?: string;
  scopes?: Record<string, string>;
  cwd?: string;
  env?: Record<string, string>;
};

export type HostServiceRequest = {
  role: HarnessServiceRole;
  registryId: string;
  method: string;
  payload: HarnessJsonValue;
};

export type HostServiceHandler = (
  request: HostServiceRequest,
) => HarnessJsonValue | Promise<HarnessJsonValue>;

export type ModelProviderCapabilities = {
  provider?: string;
  model?: string;
  models?: string[];
  semantic_actions: boolean;
  structured_output: boolean;
  multimodal_input: boolean;
  context_window_tokens?: number;
  usage_reporting: boolean;
};

export type ModelProviderCapabilityOverrides = Partial<ModelProviderCapabilities> &
  Record<string, HarnessJsonValue | undefined>;

export type EmbeddingSpaceCapability = {
  provider: string;
  model: string;
  dimensions: number;
  normalized: boolean;
};

export type EmbeddingProviderCapabilities = {
  embedding_spaces: EmbeddingSpaceCapability[];
};

export type KnowledgePackageRealization = {
  package: string;
  version: string;
  corpus?: string;
  ready: boolean;
};

export type KnowledgeProviderCapabilities = {
  modes: string[];
  features: string[];
  packages?: KnowledgePackageRealization[];
};

export type MemoryPackageRealization = {
  package: string;
  version?: string;
  ready: boolean;
};

export type MemoryProviderCapabilities = {
  descriptor: HarnessJsonValue;
  packages?: MemoryPackageRealization[];
};

export type ApprovalCapabilities = {
  approval: true;
  cancellation?: boolean;
};

export type HookCapabilities = {
  hooks: HarnessHookId[];
};

export type HostProviderCapabilities =
  | ModelProviderCapabilityOverrides
  | EmbeddingProviderCapabilities
  | KnowledgeProviderCapabilities
  | MemoryProviderCapabilities
  | Record<string, HarnessJsonValue>;

export type HookContinueDecision<TPatch extends object = Record<string, HarnessJsonValue>> = {
  decision: 'continue';
  patch?: TPatch;
};

export type HookRejectDecision = {
  decision: 'reject';
  reason: string;
};

export type HookDecision<TPatch extends object = Record<string, HarnessJsonValue>> =
  | HookContinueDecision<TPatch>
  | HookRejectDecision;

export type HookHandler<
  TInput = HarnessJsonValue,
  TPatch extends object = Record<string, HarnessJsonValue>,
> = (input: TInput) => HookDecision<TPatch> | void | Promise<HookDecision<TPatch> | void>;

export type HookPhaseSnapshot = {
  phase_id: string;
  phase_objective: string;
  completion: HarnessJsonValue;
};

export type BeforeModelRequestPhase = HookPhaseSnapshot;

export type BeforeModelRequestModel = {
  provider: string;
  model: string;
  options?: HarnessJsonValue;
};

export type BeforeModelRequestSection = {
  number: number;
  title: string;
  content: string;
  mutable: boolean;
};

export type BeforeModelRequestInput = {
  run_id: string;
  phase_execution_id: string;
  phase: BeforeModelRequestPhase;
  model?: BeforeModelRequestModel;
  sections: BeforeModelRequestSection[];
  repair_feedback?: string;
};

export type BeforeModelRequestContextSection = {
  title: string;
  content: string;
};

export type BeforeModelRequestPatch = {
  context_sections?: BeforeModelRequestContextSection[];
  provider_options?: Record<string, HarnessJsonValue>;
};

export type BeforeModelRequestDecision = HookDecision<BeforeModelRequestPatch>;

export type BeforeModelRequestHookHandler = HookHandler<
  BeforeModelRequestInput,
  BeforeModelRequestPatch
>;

export type BeforeToolSelectionCandidate = {
  canonical_id: string;
  description: string;
  source: string;
};

export type BeforeToolSelectionInput = {
  phase: HookPhaseSnapshot;
  candidates: BeforeToolSelectionCandidate[];
};

export type BeforeToolSelectionPatch = {
  candidate_ids?: string[];
};

export type BeforeToolSelectionDecision = HookDecision<BeforeToolSelectionPatch>;

export type BeforeToolSelectionHookHandler = HookHandler<
  BeforeToolSelectionInput,
  BeforeToolSelectionPatch
>;

export type BeforeToolCallInput = {
  phase_id: string;
  tool: string;
  arguments: HarnessJsonValue;
};

export type BeforeToolCallPatch = {
  arguments?: HarnessJsonValue;
};

export type BeforeToolCallDecision = HookDecision<BeforeToolCallPatch>;

export type BeforeToolCallHookHandler = HookHandler<BeforeToolCallInput, BeforeToolCallPatch>;

export type BeforeKnowledgeRequestInput = {
  phase_id: string;
  request: KnowledgeRuntimeRequest;
};

export type BeforeKnowledgeRequestPatch = {
  document?: string;
  query?: string;
  top_k?: number;
  score_threshold?: number;
  return_citations?: boolean;
};

export type BeforeKnowledgeRequestDecision = HookDecision<BeforeKnowledgeRequestPatch>;

export type BeforeKnowledgeRequestHookHandler = HookHandler<
  BeforeKnowledgeRequestInput,
  BeforeKnowledgeRequestPatch
>;

export type AfterKnowledgeRetrievalInput = {
  phase_id: string;
  result: KnowledgeRuntimeResult;
};

export type AfterKnowledgeRetrievalResultPatch = {
  chunk_id: string;
  source_id: string;
  text?: string;
};

export type AfterKnowledgeRetrievalPatch = {
  content?: string;
  results?: AfterKnowledgeRetrievalResultPatch[];
};

export type AfterKnowledgeRetrievalDecision = HookDecision<AfterKnowledgeRetrievalPatch>;

export type AfterKnowledgeRetrievalHookHandler = HookHandler<
  AfterKnowledgeRetrievalInput,
  AfterKnowledgeRetrievalPatch
>;

export type BeforeMemoryReadInput = {
  phase_id: string;
  package: string;
  space: string;
  scope: HarnessJsonValue;
  query?: string;
  filter?: HarnessJsonValue;
  limit?: number;
  mode?: string;
};

export type BeforeMemoryReadPatch = {
  query?: string;
  filter?: HarnessJsonValue;
  limit?: number;
  mode?: string;
};

export type BeforeMemoryReadDecision = HookDecision<BeforeMemoryReadPatch>;

export type BeforeMemoryReadHookHandler = HookHandler<BeforeMemoryReadInput, BeforeMemoryReadPatch>;

export type BeforeMemoryWriteInput = {
  phase_id: string;
  package: string;
  space: string;
  record_type: string;
  scope: HarnessJsonValue;
  content: HarnessJsonValue;
};

export type BeforeMemoryWritePatch = {
  content?: HarnessJsonValue;
};

export type BeforeMemoryWriteDecision = HookDecision<BeforeMemoryWritePatch>;

export type BeforeMemoryWriteHookHandler = HookHandler<
  BeforeMemoryWriteInput,
  BeforeMemoryWritePatch
>;

export type BeforeMemoryOperationInput = {
  phase_id: string;
  package: string;
  operation: string;
  scope: HarnessJsonValue;
  source_summary: HarnessJsonValue;
};

export type BeforeMemoryOperationPatch = {
  model_guidance?: string;
};

export type BeforeMemoryOperationDecision = HookDecision<BeforeMemoryOperationPatch>;

export type BeforeMemoryOperationHookHandler = HookHandler<
  BeforeMemoryOperationInput,
  BeforeMemoryOperationPatch
>;

export type GenericHookDecision = HookDecision;

export type GenericHookHandler<TInput = HarnessJsonValue> = HookHandler<TInput>;

export type ApprovalHandler = (request: HarnessJsonValue) =>
  | {
      decision: string;
    }
  | 'approve'
  | 'approved'
  | 'deny'
  | 'denied'
  | 'pending'
  | Promise<string | { decision: string }>;

export type ModelProviderHandler = (
  payload: HarnessJsonValue,
) => HarnessJsonValue | Promise<HarnessJsonValue>;

export type EmbeddingProviderRequest = {
  provider: string;
  model: string;
  dimensions: number;
  normalized: boolean;
  text: string;
};

export type EmbeddingProviderResult =
  | number[]
  | {
      vector?: number[];
      values?: number[];
      provider?: string;
      model?: string;
      dimensions?: number;
      normalized?: boolean;
      [key: string]: HarnessJsonValue | undefined;
    };

export type EmbeddingProviderHandler = (
  request: EmbeddingProviderRequest,
) => EmbeddingProviderResult | Promise<EmbeddingProviderResult>;

export type KnowledgeRequestMode = 'context_document' | 'vector_query';

export type KnowledgeRuntimeRequest = {
  package: string;
  version: string;
  mode: KnowledgeRequestMode;
  document?: string;
  query?: string;
  top_k?: number;
  score_threshold?: number;
  return_citations?: boolean;
};

export type KnowledgeRuntimeFailure = {
  code: string;
  message: string;
  retryable?: boolean;
};

export type KnowledgeRetrievalResult = {
  rank: number;
  score: number;
  chunk_id: string;
  source_id: string;
  source_title?: string;
  source_uri?: string;
  text?: string;
  chunk_metadata?: HarnessJsonValue;
  source_metadata?: HarnessJsonValue;
};

export type KnowledgeCitation = {
  chunk_id: string;
  source_id: string;
  title?: string;
  uri?: string;
};

export type KnowledgeRuntimeResult = {
  ok: boolean;
  package: string;
  version: string;
  mode: KnowledgeRequestMode;
  document?: string;
  query?: string;
  content?: string;
  results?: KnowledgeRetrievalResult[];
  citations?: KnowledgeCitation[];
  error?: KnowledgeRuntimeFailure;
};

export type KnowledgeRuntimeHandler = (
  request: KnowledgeRuntimeRequest,
) => KnowledgeRuntimeResult | Promise<KnowledgeRuntimeResult>;

type PendingRequest = {
  resolve: (value: HarnessJsonValue) => void;
  reject: (error: Error) => void;
};

type RegisteredService = {
  role: HarnessServiceRole;
  registryId: string;
  handler: HostServiceHandler;
  hooks?: HarnessHookId[];
  capabilities?: HarnessJsonValue;
  requestTimeoutMs?: number;
  registration?: HostServiceRegistrationResult;
};

const PROTOCOL = 'agentpm-harness-machine' as const;
const VERSION = 1 as const;
const DEFAULT_HOOK_REGISTRY_ID = 'sdk-hooks';

export class HarnessProtocolError extends Error {
  readonly code: string;

  constructor(error: HarnessMachineError) {
    super(error.message);
    this.name = 'HarnessProtocolError';
    this.code = error.code;
  }
}

export class HarnessClient {
  private readonly options: HarnessClientOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 0;
  private initialized = false;
  private transportError: Error | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly services = new Map<string, RegisteredService>();
  private readonly registeredServiceKeys = new Set<string>();
  private readonly registrationResults = new Map<string, HostServiceRegistrationResult>();
  private registrationFlush: Promise<void> = Promise.resolve();
  private nextHookRegistrationId = 0;
  private readonly events: HarnessEvent[] = [];
  private readonly waiters: Array<{
    predicate: (event: HarnessEvent) => boolean;
    resolve: (event: HarnessEvent) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  private readonly emitter = new EventEmitter();

  constructor(options: HarnessClientOptions = {}) {
    this.options = options;
  }

  static create(options: HarnessClientOptions = {}): HarnessClient {
    return new HarnessClient(options);
  }

  start(): void {
    if (this.transportError) throw this.transportError;
    if (this.child) return;
    const command = this.options.agentpmPath ?? process.env.AGENTPM ?? 'agentpm';
    const args = this.options.args ?? this.defaultArgs();
    const env = { ...process.env, ...this.options.env };
    this.child = spawn(command, args, {
      cwd: this.options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.readStdout(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.emitter.emit('stderr', chunk.toString('utf8'));
    });
    this.child.on('error', (error) => this.failTransport(error));
    this.child.on('close', (code, signal) => {
      this.child = null;
      this.emitter.emit('process_closed');
      if (this.pending.size > 0) {
        this.rejectAll(
          new Error(
            `Harness process exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`,
          ),
        );
      }
    });
  }

  async initialize(): Promise<HarnessSessionInfo> {
    this.start();
    const response = (await this.request('initialize', {})) as HarnessSessionInfo;
    this.initialized = true;
    await this.flushRegistrations();
    return response;
  }

  async preflight(): Promise<HarnessPreflightResult> {
    await this.ensureInitialized();
    await this.registrationFlush;
    return (await this.request('preflight', {})) as HarnessPreflightResult;
  }

  async run(
    input: string,
    payload: Record<string, HarnessJsonValue> = {},
  ): Promise<HarnessRunResult> {
    await this.ensureInitialized();
    await this.registrationFlush;
    return (await this.request('start_run', { ...payload, input })) as HarnessRunResult;
  }

  async startRun(
    input: string,
    payload: Record<string, HarnessJsonValue> = {},
  ): Promise<HarnessRunResult> {
    return this.run(input, payload);
  }

  async cancelRun(): Promise<HarnessJsonValue> {
    this.start();
    await this.registrationFlush;
    return this.request('cancel_run', {});
  }

  async invokeMemoryOperation(payload: HarnessJsonValue): Promise<HarnessJsonValue> {
    await this.ensureInitialized();
    await this.registrationFlush;
    return this.request('memory_operation', payload);
  }

  async shutdown(): Promise<HarnessJsonValue> {
    if (!this.child) return { shutdown: true };
    const response = await this.request('shutdown', {});
    this.child.stdin.end();
    return response;
  }

  stop(): void {
    if (!this.child) return;
    this.child.kill('SIGTERM');
    this.child = null;
    this.emitter.emit('process_closed');
  }

  onEvent(listener: (event: HarnessEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  onStderr(listener: (chunk: string) => void): () => void {
    this.emitter.on('stderr', listener);
    return () => this.emitter.off('stderr', listener);
  }

  waitForEvent(
    predicate: (event: HarnessEvent) => boolean,
    timeoutMs = 5_000,
  ): Promise<HarnessEvent> {
    this.start();
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error('Timed out waiting for Harness event'));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timeout });
    });
  }

  async *eventsIterator(): AsyncIterable<HarnessEvent> {
    this.start();
    let offset = 0;
    while (true) {
      while (offset < this.events.length) {
        yield this.events[offset++]!;
      }
      if (!this.child) break;
      await this.waitForEventAfter(offset);
    }
  }

  private waitForEventAfter(offset: number): Promise<void> {
    if (this.events.length > offset || !this.child) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.emitter.off('event', done);
        this.emitter.off('process_closed', done);
        resolve();
      };
      this.emitter.once('event', done);
      this.emitter.once('process_closed', done);
    });
  }

  registerHostService(
    role: HarnessServiceRole,
    registryId: string,
    handler: HostServiceHandler,
    options: {
      hooks?: HarnessHookId[];
      capabilities?: HarnessJsonValue;
      requestTimeoutMs?: number;
    } = {},
  ): this {
    const key = serviceKey(role, registryId);
    this.services.set(key, {
      role,
      registryId,
      handler,
      hooks: options.hooks,
      capabilities: options.capabilities,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.registeredServiceKeys.delete(key);
    this.registrationResults.delete(key);
    if (this.initialized) this.enqueueRegistrationFlush();
    return this;
  }

  hostServiceRegistration(
    role: HarnessServiceRole,
    registryId: string,
  ): HostServiceRegistrationResult | undefined {
    return this.registrationResults.get(serviceKey(role, registryId));
  }

  hostServiceRegistrations(): HostServiceRegistrationResult[] {
    return Array.from(this.registrationResults.values());
  }

  registerModelProvider(
    registryId: string,
    handler: ModelProviderHandler,
    capabilities: ModelProviderCapabilityOverrides = {},
  ): this {
    return this.registerHostService(
      'model',
      registryId,
      async ({ method, payload }) => {
        if (method !== 'generate') throw new Error(`Unsupported model method ${method}`);
        return handler(payload);
      },
      { capabilities: defaultModelCapabilities(registryId, capabilities) },
    );
  }

  registerEmbeddingProvider(
    registryId: string,
    handler: EmbeddingProviderHandler,
    capabilities: EmbeddingProviderCapabilities,
  ): this {
    return this.registerHostService(
      'embedding',
      registryId,
      async ({ method, payload }) => {
        if (method !== 'embed') throw new Error(`Unsupported embedding method ${method}`);
        return (await handler(payload as EmbeddingProviderRequest)) as HarnessJsonValue;
      },
      { capabilities },
    );
  }

  registerKnowledgeRuntime(
    registryId: string,
    handler: KnowledgeRuntimeHandler,
    capabilities: KnowledgeProviderCapabilities,
  ): this {
    return this.registerHostService(
      'knowledge',
      registryId,
      async ({ method, payload }) => {
        if (method !== 'retrieve') throw new Error(`Unsupported KnowledgeRuntime method ${method}`);
        return (await handler(extractKnowledgeRuntimeRequest(payload))) as HarnessJsonValue;
      },
      { capabilities },
    );
  }

  registerHostProvider(
    role: 'model',
    registryId: string,
    handler: HostServiceHandler,
    capabilities?: ModelProviderCapabilityOverrides,
  ): this;
  registerHostProvider(
    role: 'embedding',
    registryId: string,
    handler: HostServiceHandler,
    capabilities?: EmbeddingProviderCapabilities,
  ): this;
  registerHostProvider(
    role: 'knowledge',
    registryId: string,
    handler: HostServiceHandler,
    capabilities?: KnowledgeProviderCapabilities,
  ): this;
  registerHostProvider(
    role: 'memory',
    registryId: string,
    handler: HostServiceHandler,
    capabilities?: MemoryProviderCapabilities,
  ): this;
  registerHostProvider(
    role: Exclude<HarnessServiceRole, 'hook' | 'approval'>,
    registryId: string,
    handler: HostServiceHandler,
    capabilities: HostProviderCapabilities = {},
  ): this {
    return this.registerHostService(role, registryId, handler, {
      capabilities: normalizeHostProviderCapabilities(role, registryId, capabilities),
    });
  }

  onBeforeModelRequest(
    handler: BeforeModelRequestHookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_model_request', handler as GenericHookHandler, options);
  }

  onBeforeToolSelection(
    handler: BeforeToolSelectionHookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_tool_selection', handler as GenericHookHandler, options);
  }

  onBeforeToolCall(
    handler: BeforeToolCallHookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_tool_call', handler as GenericHookHandler, options);
  }

  onBeforeKnowledgeRequest(
    handler: BeforeKnowledgeRequestHookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_knowledge_request', handler as GenericHookHandler, options);
  }

  onAfterKnowledgeRetrieval(
    handler: AfterKnowledgeRetrievalHookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('after_knowledge_retrieval', handler as GenericHookHandler, options);
  }

  onBeforeMemoryRead(
    handler: BeforeMemoryReadHookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_memory_read', handler as GenericHookHandler, options);
  }

  onBeforeMemoryWrite(
    handler: BeforeMemoryWriteHookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_memory_write', handler as GenericHookHandler, options);
  }

  onBeforeMemoryOperation(
    handler: BeforeMemoryOperationHookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_memory_operation', handler as GenericHookHandler, options);
  }

  registerHook(
    hook: HarnessHookId,
    handler: GenericHookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    const registryId = this.allocateHookRegistryId(options.registryId ?? DEFAULT_HOOK_REGISTRY_ID);
    this.registerHostService(
      'hook',
      registryId,
      async ({ method, payload }) => {
        if (method !== hook) throw new Error(`Unsupported Hook method ${method}`);
        const decision = await handler(extractHookInput(payload));
        return decision ?? { decision: 'continue' };
      },
      {
        hooks: [hook],
        capabilities: { hooks: [hook] } satisfies HookCapabilities,
        requestTimeoutMs: options.requestTimeoutMs,
      },
    );
    return this;
  }

  private allocateHookRegistryId(base: string): string {
    if (!this.services.has(serviceKey('hook', base))) return base;
    let registryId: string;
    do {
      registryId = `${base}-${++this.nextHookRegistrationId}`;
    } while (this.services.has(serviceKey('hook', registryId)));
    return registryId;
  }

  onApproval(handler: ApprovalHandler, capabilities: Partial<ApprovalCapabilities> = {}): this {
    return this.registerHostService(
      'approval',
      'controller',
      async ({ method, payload }) => {
        if (method !== 'request_approval') {
          throw new Error(`Unsupported approval method ${method}`);
        }
        const decision = await handler(payload);
        return typeof decision === 'string' ? { decision } : decision;
      },
      { capabilities: defaultApprovalCapabilities(capabilities) },
    );
  }

  private defaultArgs(): string[] {
    const args = ['harness'];
    if (this.options.agent) args.push(this.options.agent);
    if (this.options.configPath) args.push('--config', this.options.configPath);
    if (this.options.stateDir) args.push('--state-dir', this.options.stateDir);
    for (const [key, value] of Object.entries(this.options.scopes ?? {})) {
      args.push('--scope', `${key}=${value}`);
    }
    args.push('--machine');
    return args;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }

  private async flushRegistrations(): Promise<void> {
    for (const service of this.services.values()) await this.flushRegistration(service);
  }

  private enqueueRegistrationFlush(): void {
    this.registrationFlush = this.registrationFlush.then(() => this.flushRegistrations());
  }

  private async flushRegistration(service: RegisteredService): Promise<void> {
    const key = serviceKey(service.role, service.registryId);
    if (this.registeredServiceKeys.has(key)) return;
    const response = await this.request('register_host_service', {
      role: service.role,
      registry_id: service.registryId,
      capabilities: service.capabilities ?? {},
      hooks: service.hooks ?? [],
      request_timeout_ms: service.requestTimeoutMs ?? 120_000,
    });
    const registration = normalizeHostServiceRegistrationResult(response, service);
    service.registration = registration;
    this.registrationResults.set(key, registration);
    this.registeredServiceKeys.add(key);
  }

  private request(method: string, payload: HarnessJsonValue): Promise<HarnessJsonValue> {
    if (this.transportError) return Promise.reject(this.transportError);
    this.start();
    if (this.transportError) return Promise.reject(this.transportError);
    const id = `sdk-${++this.nextId}`;
    const frame: HarnessMachineFrame = {
      protocol: PROTOCOL,
      version: VERSION,
      kind: 'request',
      id,
      method,
      payload,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.writeFrame(frame);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private readStdout(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let frame: HarnessMachineFrame;
    try {
      frame = JSON.parse(line) as HarnessMachineFrame;
    } catch (error) {
      this.failTransport(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    if (frame.protocol !== PROTOCOL || frame.version !== VERSION) {
      this.failTransport(new Error('Unsupported Harness machine protocol frame'));
      return;
    }
    if (frame.kind === 'event') {
      this.recordEvent((frame.payload ?? {}) as HarnessEvent);
      return;
    }
    if (frame.kind === 'request' && frame.method === 'host_service') {
      void this.dispatchHostService(frame);
      return;
    }
    if (!frame.id) return;
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    this.pending.delete(frame.id);
    if (frame.kind === 'error') {
      pending.reject(
        new HarnessProtocolError(
          frame.error ?? { code: 'protocol_error', message: 'Harness returned an error frame' },
        ),
      );
    } else {
      pending.resolve(frame.payload ?? null);
    }
  }

  private recordEvent(event: HarnessEvent): void {
    this.events.push(event);
    this.emitter.emit('event', event);
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(event)) continue;
      clearTimeout(waiter.timeout);
      const index = this.waiters.indexOf(waiter);
      if (index >= 0) this.waiters.splice(index, 1);
      waiter.resolve(event);
    }
  }

  private async dispatchHostService(frame: HarnessMachineFrame): Promise<void> {
    const request = frame.payload as {
      role?: HarnessServiceRole;
      registry_id?: string;
      method?: string;
      payload?: HarnessJsonValue;
    };
    const role = request.role;
    const registryId = request.registry_id;
    const method = request.method;
    if (!role || !registryId || !method) {
      this.writeError(
        frame.id,
        'host_service_bad_request',
        'Host service request is missing role, registry_id, or method',
      );
      return;
    }
    const service = this.services.get(serviceKey(role, registryId));
    if (!service) {
      this.writeError(
        frame.id,
        'host_service_not_registered',
        `No host service registered for ${role}:${registryId}`,
      );
      return;
    }
    try {
      const payload = await withTimeout(
        service.handler({
          role,
          registryId,
          method,
          payload: request.payload ?? {},
        }),
        service.requestTimeoutMs ?? 120_000,
        `Host service ${role}:${registryId} timed out`,
      );
      this.writeFrame({
        protocol: PROTOCOL,
        version: VERSION,
        kind: 'response',
        id: frame.id,
        payload: payload ?? {},
      });
    } catch (error) {
      this.writeError(
        frame.id,
        'host_service_callback_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private writeFrame(frame: HarnessMachineFrame): void {
    if (!this.child?.stdin.writable) throw new Error('Harness process is not running');
    this.child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  private writeError(id: string | undefined, code: string, message: string): void {
    this.writeFrame({
      protocol: PROTOCOL,
      version: VERSION,
      kind: 'error',
      id,
      error: { code, message },
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
  }

  private failTransport(error: Error): void {
    if (!this.transportError) this.transportError = error;
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill('SIGTERM');
    this.emitter.emit('process_closed');
    this.rejectAll(this.transportError);
  }
}

export const Harness = HarnessClient;

function serviceKey(role: HarnessServiceRole, registryId: string): string {
  return `${role}:${registryId}`;
}

function normalizeHostServiceRegistrationResult(
  value: HarnessJsonValue,
  service: RegisteredService,
): HostServiceRegistrationResult {
  const fallback: HostServiceRegistrationResult = {
    registered: true,
    service: {
      role: service.role,
      registry_id: service.registryId,
    },
    active: true,
  };
  if (!isJsonObject(value)) return fallback;
  const serviceValue = isJsonObject(value.service) ? value.service : undefined;
  const role =
    typeof serviceValue?.role === 'string'
      ? (serviceValue.role as HarnessServiceRole)
      : service.role;
  const registryId =
    typeof serviceValue?.registry_id === 'string' ? serviceValue.registry_id : service.registryId;
  return {
    ...value,
    registered: typeof value.registered === 'boolean' ? value.registered : true,
    service: {
      role,
      registry_id: registryId,
    },
    active: typeof value.active === 'boolean' ? value.active : true,
    reason: typeof value.reason === 'string' || value.reason === null ? value.reason : undefined,
  };
}

function isJsonObject(
  value: HarnessJsonValue | undefined,
): value is { [key: string]: HarnessJsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultModelCapabilities(
  registryId: string,
  overrides: ModelProviderCapabilityOverrides,
): HarnessJsonValue {
  return {
    provider: registryId,
    semantic_actions: true,
    structured_output: true,
    multimodal_input: false,
    usage_reporting: true,
    ...overrides,
  };
}

function normalizeHostProviderCapabilities(
  role: Exclude<HarnessServiceRole, 'hook' | 'approval'>,
  registryId: string,
  capabilities: HostProviderCapabilities,
): HarnessJsonValue {
  if (role === 'model') {
    return defaultModelCapabilities(registryId, capabilities as ModelProviderCapabilityOverrides);
  }
  return capabilities as HarnessJsonValue;
}

function defaultApprovalCapabilities(overrides: Partial<ApprovalCapabilities>): HarnessJsonValue {
  return {
    approval: true,
    cancellation: false,
    ...overrides,
  };
}

function extractHookInput(payload: HarnessJsonValue): HarnessJsonValue {
  return typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    'input' in payload
    ? (payload.input as HarnessJsonValue)
    : payload;
}

function extractKnowledgeRuntimeRequest(payload: HarnessJsonValue): KnowledgeRuntimeRequest {
  return typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    'request' in payload
    ? (payload.request as KnowledgeRuntimeRequest)
    : (payload as KnowledgeRuntimeRequest);
}

function withTimeout<T>(value: T | Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(value).then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
