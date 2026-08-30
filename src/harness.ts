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

export type HarnessClientOptions = {
  agentpmPath?: string;
  args?: string[];
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

export type HookDecision =
  | {
      decision?: 'continue';
      patch?: Record<string, HarnessJsonValue>;
    }
  | {
      decision: 'reject';
      reason: string;
    };

export type HookHandler<TInput = HarnessJsonValue> = (
  input: TInput,
) => HookDecision | void | Promise<HookDecision | void>;

export type ApprovalHandler = (
  request: HarnessJsonValue,
) =>
  | 'approve'
  | 'approved'
  | 'deny'
  | 'denied'
  | 'pending'
  | { decision: string }
  | Promise<string | { decision: string }>;

export type ModelProviderHandler = (
  payload: HarnessJsonValue,
) => HarnessJsonValue | Promise<HarnessJsonValue>;

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
    if (this.initialized) this.enqueueRegistrationFlush();
    return this;
  }

  registerModelProvider(
    registryId: string,
    handler: ModelProviderHandler,
    capabilities: HarnessJsonValue = defaultModelCapabilities(),
  ): this {
    return this.registerHostService(
      'model',
      registryId,
      async ({ method, payload }) => {
        if (method !== 'generate') throw new Error(`Unsupported model method ${method}`);
        return handler(payload);
      },
      { capabilities },
    );
  }

  registerHostProvider(
    role: Exclude<HarnessServiceRole, 'hook' | 'approval'>,
    registryId: string,
    handler: HostServiceHandler,
    capabilities: HarnessJsonValue = {},
  ): this {
    return this.registerHostService(role, registryId, handler, { capabilities });
  }

  onBeforeModelRequest(
    handler: HookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_model_request', handler, options);
  }

  onBeforeToolSelection(
    handler: HookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_tool_selection', handler, options);
  }

  onBeforeToolCall(
    handler: HookHandler,
    options: { registryId?: string; requestTimeoutMs?: number } = {},
  ): this {
    return this.registerHook('before_tool_call', handler, options);
  }

  registerHook(
    hook: HarnessHookId,
    handler: HookHandler,
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
        capabilities: { hooks: [hook] },
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

  onApproval(handler: ApprovalHandler): this {
    return this.registerHostService('approval', 'controller', async ({ method, payload }) => {
      if (method !== 'request_approval') throw new Error(`Unsupported approval method ${method}`);
      const decision = await handler(payload);
      return typeof decision === 'string' ? { decision } : decision;
    });
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
    await this.request('register_host_service', {
      role: service.role,
      registry_id: service.registryId,
      capabilities: service.capabilities ?? {},
      hooks: service.hooks ?? [],
      request_timeout_ms: service.requestTimeoutMs ?? 120_000,
    });
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

function defaultModelCapabilities(): HarnessJsonValue {
  return {
    semantic_actions: true,
    structured_output: true,
    multimodal_input: false,
    usage_reporting: true,
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
