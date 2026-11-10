import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  statSync,
  unlinkSync,
  existsSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

import { expect, it, vi } from 'vitest';

import { load } from '../src';

it.skipIf(!process.env.AGENTPM_TEST_CLI || !process.env.AGENTPM_TEST_UV)(
  'invokes native Python through the real CLI without provisioning at call time',
  async () => {
    const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'sdk native with spaces ')));
    const cwd = process.cwd();
    const cli = process.env.AGENTPM_TEST_CLI!;
    const python =
      process.env.AGENTPM_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    try {
      const setup = spawnSync(
        python,
        [
          join(import.meta.dirname, 'fixtures/sdk-v1/native_fixture.py'),
          project,
          cli,
          process.env.AGENTPM_TEST_UV!,
          python,
        ],
        { encoding: 'utf8', timeout: 180000 },
      );
      expect(setup.status, setup.stderr).toBe(0);
      process.chdir(project);
      vi.stubEnv('AGENTPM', cli);
      vi.stubEnv('AGENTPM_PYTHON', python);
      vi.stubEnv('AGENTPM_UV_PATH', join(project, 'must-not-resolve'));
      const shadow = join(project, 'shadow');
      mkdirSync(shadow);
      writeFileSync(join(shadow, 'pydantic.py'), 'raise RuntimeError("ambient shadow imported")');
      vi.stubEnv('PYTHONPATH', shadow);
      vi.stubEnv('PYTHONHOME', shadow);
      const lock = join(project, 'agent.lock');
      const before = readFileSync(lock);
      const ready = readdirSync(join(project, '.agentpm/runtimes/python'), {
        recursive: true,
      }).find((name) => String(name).endsWith('ready.json'));
      expect(ready).toBeDefined();
      const readyPath = join(project, '.agentpm/runtimes/python', String(ready));
      const readyBytes = readFileSync(readyPath),
        readyTime = statSync(readyPath).mtimeMs;
      const metadata = join(project, '.agentpm/tools/fixture/tool/1.0.0/agentpm-python.json');
      const originalMetadata = readFileSync(metadata);
      const loaded = await load('@fixture/tool@1.0.0', {
        withMeta: true,
        env: { LAYER: 'caller' },
      });
      const result = (await loaded.func({ quantity: 2, unit_price: 4.5 })) as Record<
        string,
        unknown
      >;
      expect(result.total).toBe(9);
      expect(result.layer).toBe('caller');
      expect(result.pydantic_version).toBe('2.11.7');
      expect(result.pythonpath).toBeNull();
      expect(result.pythonhome).toBeNull();
      // Windows may report long paths while the runner temp directory uses an 8.3 alias.
      const runtimeRoot = realpathSync.native(join(project, '.agentpm/runtimes/python'));
      for (const key of ['prefix', 'executable', 'native_file', 'pydantic_file']) {
        const reported = String(result[key]);
        // Unix venv executables may be symlinks to the host interpreter: compare
        // the invoked path inside the venv, while resolving its parent aliases.
        const location =
          key === 'executable'
            ? join(realpathSync.native(dirname(reported)), basename(reported))
            : realpathSync.native(reported);
        const subpath = relative(runtimeRoot, location);
        expect(isAbsolute(subpath)).toBe(false);
        expect(subpath).not.toBe('');
        expect(subpath.split(sep)[0]).not.toBe('..');
      }
      expect(String(result.native_file)).toMatch(/\.(so|pyd)$/);
      expect(readFileSync(lock)).toEqual(before);
      expect(readFileSync(readyPath)).toEqual(readyBytes);
      expect(statSync(readyPath).mtimeMs).toBe(readyTime);
      const timeoutTool = await load('@fixture/tool@1.0.0', { timeoutMs: 200 });
      await expect(timeoutTool({ quantity: 2, unit_price: 4.5, pause: true })).rejects.toThrow(
        /timeout|timed out/,
      );
      const marker = join(project, '.agentpm/tools/fixture/tool/.1.0.0.selection.json');
      writeFileSync(marker, JSON.stringify({ target: 'incompatible-fixture' }));
      await expect(loaded.func({ quantity: 2, unit_price: 4.5 })).rejects.toThrow(
        'target/state changed',
      );
      unlinkSync(marker);
      const alternate = join(project, 'alternate-python');
      const venv = spawnSync(python, ['-I', '-m', 'venv', '--without-pip', alternate], {
        encoding: 'utf8',
      });
      expect(venv.status, venv.stderr).toBe(0);
      vi.stubEnv(
        'AGENTPM_PYTHON',
        join(alternate, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
      );
      await expect(loaded.func({ quantity: 2, unit_price: 4.5 })).rejects.toThrow(
        'agentpm install',
      );
      vi.stubEnv('AGENTPM_PYTHON', python);
      writeFileSync(metadata, '{}');
      await expect(loaded.func({ quantity: 2, unit_price: 4.5 })).rejects.toThrow(
        'agentpm install',
      );
      expect(readFileSync(metadata, 'utf8')).toBe('{}');
      writeFileSync(metadata, originalMetadata);
      unlinkSync(readyPath);
      await expect(loaded.func({ quantity: 2, unit_price: 4.5 })).rejects.toThrow(
        'agentpm install',
      );
      expect(existsSync(readyPath)).toBe(false);
      expect(readFileSync(lock)).toEqual(before);
      writeFileSync(readyPath, readyBytes);
      expect(
        ((await loaded.func({ quantity: 1, unit_price: 3 })) as Record<string, unknown>).total,
      ).toBe(3);
    } finally {
      process.chdir(cwd);
      vi.unstubAllEnvs();
      rmSync(project, { recursive: true, force: true });
    }
  },
  240000,
);
