import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import type { JsonValue } from './index';

const GUIDANCE =
  'Install AgentPM CLI >=0.1.43 and make agentpm available on PATH (or set AGENTPM).';
const MAX_TRANSPORT_BYTES = 12 * 1024 * 1024;

function redact(text: string, env: NodeJS.ProcessEnv): string {
  const secrets = Object.entries(env)
    .filter(
      ([key, value]) =>
        value &&
        /token|secret|password|passphrase|api.?key|authorization|credential|_key(?:$|_)/i.test(key),
    )
    .map(([, value]) => value!)
    .sort((a, b) => b.length - a.length);
  for (const value of secrets) text = text.split(value).join('[REDACTED]');
  return text;
}

function stop(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    // CLI TERM handling cleans the Tool's own process group.
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
  }
}

export async function invoke(
  project: string,
  directory: string,
  spec: string,
  input: JsonValue,
  timeoutMs: number,
  environment: Record<string, string>,
  redactionEnvironment: Record<string, string> = {},
): Promise<JsonValue> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('Tool timeout must be a positive finite integer in milliseconds');
  const command = process.env.AGENTPM || 'agentpm';
  const env = { ...process.env, ...environment };
  const redactionEnv = { ...env, ...redactionEnvironment, ...environment };
  const version = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    env,
    timeout: 5000,
    maxBuffer: 65536,
  });
  const match = /^agentpm (\d+)\.(\d+)\.(\d+)\s*$/.exec(version.stdout ?? '');
  if (
    version.error ||
    version.status !== 0 ||
    !match ||
    !(
      Number(match[1]) > 0 ||
      Number(match[2]) > 1 ||
      (Number(match[2]) === 1 && Number(match[3]) >= 43)
    )
  )
    throw new Error(GUIDANCE);
  const request = JSON.stringify({
    schema_version: 1,
    input,
    environment,
    tool_directory: resolve(directory),
  });
  return new Promise((fulfill, reject) => {
    const child = spawn(
      command,
      ['run', spec, '--machine', '--sdk-request', '--timeout-ms', String(timeoutMs)],
      { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    const buffers: Buffer[][] = [[], []];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(
      () =>
        fail(
          new Error('AgentPM CLI did not complete the invocation timeout; check the installed CLI'),
        ),
      timeoutMs + 10000,
    );
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop(child);
      reject(error);
    }
    child.once('error', () => fail(new Error(GUIDANCE)));
    child.stdin.on('error', () => {
      /* Early CLI rejection may close stdin. close supplies the error envelope. */
    });
    [child.stdout, child.stderr].forEach((stream, i) =>
      stream.on('data', (chunk: Buffer) => {
        if (settled) return;
        bytes += chunk.length;
        if (bytes > MAX_TRANSPORT_BYTES)
          fail(new Error('AgentPM CLI output exceeded the SDK transport limit'));
        else buffers[i]!.push(chunk);
      }),
    );
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stderr = redact(Buffer.concat(buffers[1]!).toString('utf8'), redactionEnv);
      if (stderr) process.stderr.write(stderr);
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(Buffer.concat(buffers[0]!).toString('utf8'));
      } catch {
        reject(new Error('Invalid AgentPM CLI machine response; ' + GUIDANCE));
        return;
      }
      if (!value || typeof value !== 'object' || value.schema_version !== 1) {
        reject(new Error('Unsupported AgentPM CLI machine response; ' + GUIDANCE));
        return;
      }
      const error = value.error as { category?: unknown; message?: unknown } | undefined;
      if (
        value.status === 'error' &&
        error &&
        typeof error.category === 'string' &&
        typeof error.message === 'string'
      ) {
        reject(new Error(redact(`AgentPM ${error.category}: ${error.message}`, redactionEnv)));
        return;
      }
      const tool = value.tool as { package?: unknown; version?: unknown } | undefined;
      if (
        code !== 0 ||
        value.status !== 'success' ||
        !Object.hasOwn(value, 'output') ||
        !tool ||
        typeof tool.package !== 'string' ||
        typeof tool.version !== 'string' ||
        `${tool.package}@${tool.version}` !== spec
      ) {
        reject(new Error('Invalid or unsuccessful AgentPM CLI machine response; ' + GUIDANCE));
        return;
      }
      fulfill(value.output as JsonValue);
    });
    child.stdin.end(request);
  });
}
