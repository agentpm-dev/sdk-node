import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadLoop } from '../src';

function makeInstalledLoop(baseDir: string, spec: string, loop: Record<string, unknown>) {
  const atIdx = spec.lastIndexOf('@');
  const packageName = spec.slice(0, atIdx);
  const version = spec.slice(atIdx + 1);
  const root = join(baseDir, `${packageName}/${version}`);
  const manifestName = packageName.slice(packageName.indexOf('/') + 1);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'agent.json'),
    JSON.stringify(
      {
        kind: 'loop',
        name: manifestName,
        version,
        description: 'Installed loop fixture',
        loop,
      },
      null,
      2,
    ),
    'utf8',
  );
}

describe('agentpm node sdk - loadLoop', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agentpm-sdk-loop-test-'));
  const loopDir = join(tmp, '.agentpm', 'loops');

  beforeAll(() => {
    makeInstalledLoop(loopDir, '@zack/incident-response-loop@0.1.0', {
      entry_phase: 'assess',
      phases: [{ id: 'assess', objective: 'Assess the request.' }],
      transitions: [{ from: 'assess', on: 'complete', to: '$end' }],
    });
    makeInstalledLoop(loopDir, '@zack/review-loop@0.2.0', {
      archetype: 'investigate_review_respond',
      entry_phase: 'triage',
      limits: { max_steps: 16 },
      phases: [
        {
          id: 'triage',
          objective: 'Assess whether work should continue.',
          access: {
            tools: false,
            knowledge: true,
            memory: {
              read: true,
              write: false,
            },
          },
          outcomes: [
            { id: 'proceed', description: 'Continue into execution.' },
            { id: 'handoff', description: 'Transfer ownership.' },
          ],
        },
        { id: 'execute', objective: 'Complete the work.' },
      ],
      transitions: [
        { from: 'triage', on: 'proceed', to: 'execute' },
        { from: 'triage', on: 'handoff', to: '$handoff' },
        { from: 'execute', on: 'complete', to: '$end' },
      ],
      checkpoints: [
        {
          id: 'approve-response',
          type: 'approval',
          before_phase: 'execute',
          on_reject: '$abort',
        },
      ],
      error_policy: {
        tool_failure: {
          action: 'retry',
          max_retries: 2,
          on_exhausted: 'fail_phase',
        },
        phase_failure: {
          action: 'handoff',
        },
      },
    });
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads installed minimal loop metadata', async () => {
    const loaded = await loadLoop('@zack/incident-response-loop@0.1.0', {
      loopDirOverride: loopDir,
    });

    expect(loaded.kind).toBe('loop');
    expect(loaded.loop.entry_phase).toBe('assess');
    expect(loaded.loop.transitions).toEqual([{ from: 'assess', on: 'complete', to: '$end' }]);
  });

  it('loads installed full loop metadata through the loop override', async () => {
    const loaded = await loadLoop('@zack/review-loop@0.2.0', {
      loopDirOverride: loopDir,
    });

    expect(loaded.loop.archetype).toBe('investigate_review_respond');
    expect(loaded.loop.limits?.max_steps).toBe(16);
    expect(loaded.loop.phases[0]?.access?.memory?.read).toBe(true);
    expect(loaded.loop.checkpoints?.[0]?.before_phase).toBe('execute');
    expect(loaded.loop.error_policy?.tool_failure?.action).toBe('retry');
  });

  it('fails with a clear error when the loop package is not installed', async () => {
    await expect(
      loadLoop('@zack/missing-loop@0.1.0', {
        loopDirOverride: loopDir,
      }),
    ).rejects.toThrow(/not found in \.agentpm\/loops/i);
  });

  it('fails when the installed manifest is not kind loop', async () => {
    const badSpec = '@zack/not-loop@0.1.0';
    const atIdx = badSpec.lastIndexOf('@');
    const packageName = badSpec.slice(0, atIdx);
    const version = badSpec.slice(atIdx + 1);
    const root = join(loopDir, `${packageName}/${version}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'agent.json'),
      JSON.stringify(
        {
          kind: 'tool',
          name: 'not-loop',
          version,
          entrypoint: { command: 'node', args: ['tool.js'] },
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadLoop(badSpec, {
        loopDirOverride: loopDir,
      }),
    ).rejects.toThrow(/not a loop manifest/i);
  });

  it('fails when the installed loop manifest is missing loop metadata', async () => {
    const badSpec = '@zack/missing-loop-object@0.1.0';
    const atIdx = badSpec.lastIndexOf('@');
    const packageName = badSpec.slice(0, atIdx);
    const version = badSpec.slice(atIdx + 1);
    const root = join(loopDir, `${packageName}/${version}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'agent.json'),
      JSON.stringify(
        {
          kind: 'loop',
          name: 'missing-loop-object',
          version,
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadLoop(badSpec, {
        loopDirOverride: loopDir,
      }),
    ).rejects.toThrow(/missing loop object/i);
  });
});
