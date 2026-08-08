import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadProfile } from '../src';

function makeInstalledProfile(baseDir: string, spec: string, profile: Record<string, unknown>) {
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
        kind: 'profile',
        name: manifestName,
        version,
        description: 'Installed profile fixture',
        profile,
      },
      null,
      2,
    ),
    'utf8',
  );
}

describe('agentpm node sdk - loadProfile', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agentpm-sdk-profile-test-'));
  const profileDir = join(tmp, '.agentpm', 'profiles');

  beforeAll(() => {
    makeInstalledProfile(profileDir, '@zack/support-style@0.1.0', {
      identity: { role: 'Support agent' },
      objectives: ['Help users move forward'],
      communication: {
        tone: ['calm'],
        verbosity: 'balanced',
      },
    });
    makeInstalledProfile(profileDir, '@zack/escalation-style@0.2.0', {
      identity: {
        role: 'Escalation reviewer',
        description: 'Coordinate clear next steps for escalations.',
        expertise: ['Tier-two support', 'Customer recovery'],
      },
      objectives: ['Clarify the escalation path', 'Capture accountable next steps'],
      principles: ['State ownership clearly'],
      audience: {
        description: 'Customers awaiting escalation outcomes',
        adaptation: ['Avoid jargon unless the user already used it'],
      },
      communication: {
        tone: ['direct', 'calm'],
        verbosity: 'concise',
        guidelines: ['Lead with the decision'],
        formatting: ['Use short bullets for action items'],
        vocabulary: {
          prefer: ['next step'],
          avoid: ['circle back'],
        },
      },
      boundaries: ['Do not promise timelines you cannot confirm'],
      constraints: [
        {
          id: 'confirm-accountability',
          strength: 'required',
          instruction: 'Always identify the team or person who owns the next action.',
        },
      ],
      compatibility: {
        minimum_context_tokens: 4000,
        requires: { tool_use: true },
        recommends: { structured_output: true },
      },
    });
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('loads installed minimal profile metadata', async () => {
    const loaded = await loadProfile('@zack/support-style@0.1.0', {
      profileDirOverride: profileDir,
    });

    expect(loaded.kind).toBe('profile');
    expect(loaded.profile.identity.role).toBe('Support agent');
    expect(loaded.profile.communication.verbosity).toBe('balanced');
  });

  it('loads installed full profile metadata through the profile override', async () => {
    const loaded = await loadProfile('@zack/escalation-style@0.2.0', {
      profileDirOverride: profileDir,
    });

    expect(loaded.profile.identity.expertise).toEqual(['Tier-two support', 'Customer recovery']);
    expect(loaded.profile.constraints?.[0]?.id).toBe('confirm-accountability');
    expect(loaded.profile.compatibility?.requires?.tool_use).toBe(true);
  });

  it('fails with a clear error when the profile package is not installed', async () => {
    await expect(
      loadProfile('@zack/missing-style@0.1.0', {
        profileDirOverride: profileDir,
      }),
    ).rejects.toThrow(/not found in \.agentpm\/profiles/i);
  });

  it('fails when the installed manifest is not kind profile', async () => {
    const badSpec = '@zack/not-profile@0.1.0';
    const atIdx = badSpec.lastIndexOf('@');
    const packageName = badSpec.slice(0, atIdx);
    const version = badSpec.slice(atIdx + 1);
    const root = join(profileDir, `${packageName}/${version}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'agent.json'),
      JSON.stringify(
        {
          kind: 'tool',
          name: 'not-profile',
          version,
          entrypoint: { command: 'node', args: ['tool.js'] },
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadProfile(badSpec, {
        profileDirOverride: profileDir,
      }),
    ).rejects.toThrow(/not a profile manifest/i);
  });

  it('fails when the installed profile manifest is missing profile metadata', async () => {
    const badSpec = '@zack/missing-profile-object@0.1.0';
    const atIdx = badSpec.lastIndexOf('@');
    const packageName = badSpec.slice(0, atIdx);
    const version = badSpec.slice(atIdx + 1);
    const root = join(profileDir, `${packageName}/${version}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'agent.json'),
      JSON.stringify(
        {
          kind: 'profile',
          name: 'missing-profile-object',
          version,
        },
        null,
        2,
      ),
      'utf8',
    );

    await expect(
      loadProfile(badSpec, {
        profileDirOverride: profileDir,
      }),
    ).rejects.toThrow(/missing profile object/i);
  });
});
