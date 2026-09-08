import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));

vi.mock('child_process', () => ({ execFile: execFileMock }));

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  vi.restoreAllMocks();
  execFileMock.mockReset();
  Reflect.deleteProperty(globalThis, '__APP_CONFIG__');
});

describe('template repository refresh lock', () => {
  it('makes ensureTemplateRepoFresh wait for a direct updateRepo call', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'template-repo-lock-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'templates', 'template'), { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const repositoryUrl = 'https://gogs.example.com/team/templates';
    globalThis.__APP_CONFIG__ = {
      cloud: { domain: 'example.com', port: 443, regionUid: '', certSecretName: '' },
      template: {
        ui: {
          brandName: 'Sealos',
          forcedLanguage: 'en',
          currencySymbol: 'shellCoin',
          meta: { canonicalUrl: '', customScripts: [] },
          carousel: { enabled: false, slides: [] }
        },
        repo: { url: repositoryUrl, branch: 'main', localDir: 'template' },
        features: { fetchReadme: false, showAuthor: false, guide: false },
        categories: [],
        desktopDomain: '',
        userDomain: '',
        billingUrl: '',
        analytics: { rybbit: { host: '', siteId: '' } }
      }
    };

    const pullStarted = vi.fn();
    let releasePull!: () => void;
    const pullFinished = new Promise<void>((resolve) => {
      releasePull = resolve;
    });

    execFileMock.mockImplementation((...args: unknown[]) => {
      const commandArgs = args[1] as string[];
      const callback = args[args.length - 1] as (error: null, result: object) => void;
      const result = { stdout: '', stderr: '' };

      if (commandArgs.includes('remote')) result.stdout = repositoryUrl;
      if (commandArgs.includes('branch')) result.stdout = 'main';
      if (commandArgs.includes('pull')) {
        pullStarted();
        void pullFinished.then(() => callback(null, result));
        return;
      }

      queueMicrotask(() => callback(null, result));
    });

    const { ensureTemplateRepoFresh, updateRepo } = await import(
      '@/services/backend/template-repo'
    );
    const directRefresh = updateRepo();
    await vi.waitFor(() => expect(pullStarted).toHaveBeenCalledTimes(1));

    const ensuredRefresh = ensureTemplateRepoFresh(root);
    expect(pullStarted).toHaveBeenCalledTimes(1);

    releasePull();
    await Promise.all([directRefresh, ensuredRefresh]);
    expect(pullStarted).toHaveBeenCalledTimes(1);
  });
});
