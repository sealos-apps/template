import { K8sApiDefault } from '@/services/backend/kubernetes';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import util from 'util';
import * as k8s from '@kubernetes/client-node';
import { getYamlTemplate } from '@/utils/json-yaml';
import { Config } from '@/config';
import { resolveTemplateAssetUrls } from '@/utils/templateAsset';
import { syncTemplateCategoriesFromRepo } from './template-categories';
import { readmeCache } from '@/utils/readmeCache';

const execFileAsync = util.promisify(execFile);
const DEFAULT_TEMPLATE_REPO_SYNC_INTERVAL_MS = 30 * 1000;

let templateRepoLastSyncedAt = 0;
let templateRepoSyncPromise: Promise<void> | null = null;

class TemplateRepoCheckoutMismatchError extends Error {
  code = 'TEMPLATE_REPO_CHECKOUT_MISMATCH';
}

function getTemplateRepoSyncIntervalMs() {
  const rawValue = Number(process.env.TEMPLATE_REPO_SYNC_INTERVAL_MS);
  if (!Number.isFinite(rawValue) || rawValue < 0) return DEFAULT_TEMPLATE_REPO_SYNC_INTERVAL_MS;
  return rawValue;
}

function normalizeTemplateRepoRef(value: string) {
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}

export function isTemplateRepoCheckoutCompatible(
  existingRemote: string,
  existingBranch: string,
  templateRepoUrl: string,
  templateRepoBranch: string
) {
  return (
    Boolean(existingRemote) &&
    normalizeTemplateRepoRef(existingRemote) === normalizeTemplateRepoRef(templateRepoUrl) &&
    existingBranch === templateRepoBranch
  );
}

async function cloneOrRefreshTemplateRepo(
  targetPath: string,
  templateRepoUrl: string,
  templateRepoBranch: string
) {
  let existingRemote = '';
  let existingBranch = '';

  if (fs.existsSync(targetPath)) {
    try {
      existingRemote = (
        await execFileAsync('git', ['-C', targetPath, 'remote', 'get-url', 'origin'], {
          timeout: 10000
        })
      ).stdout.trim();
      existingBranch = (
        await execFileAsync('git', ['-C', targetPath, 'branch', '--show-current'], {
          timeout: 10000
        })
      ).stdout.trim();
    } catch {
      // A prebuilt image may contain a template directory without a usable Git checkout.
    }
  }

  const repositoryChanged =
    Boolean(existingRemote) &&
    !isTemplateRepoCheckoutCompatible(
      existingRemote,
      existingBranch,
      templateRepoUrl,
      templateRepoBranch
    );

  if (!existingRemote || repositoryChanged) {
    const stagingPath = `${targetPath}.clone-${process.pid}-${Date.now()}`;
    try {
      await execFileAsync(
        'git',
        ['clone', '-b', templateRepoBranch, templateRepoUrl, stagingPath, '--depth=1'],
        { timeout: 60000 }
      );
      if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
      fs.renameSync(stagingPath, targetPath);
    } catch (error) {
      if (existingRemote && repositoryChanged) {
        throw new TemplateRepoCheckoutMismatchError(
          `template repository checkout does not match configured remote/branch: ${error}`
        );
      }
      throw error;
    } finally {
      if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { recursive: true, force: true });
    }
    return;
  }

  await execFileAsync('git', ['-C', targetPath, 'pull', '--depth=1', '--rebase'], {
    timeout: 60000
  });
}

function writeFileAtomic(targetPath: string, content: string) {
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, { encoding: 'utf-8', flag: 'wx' });
    fs.renameSync(tempPath, targetPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

const readFileList = (
  targetPath: string,
  repositoryRoot: string,
  fileList: string[] = [],
  visitedDirectories = new Set<string>()
) => {
  let realTargetPath: string;
  try {
    realTargetPath = fs.realpathSync(targetPath);
  } catch {
    return fileList;
  }

  if (visitedDirectories.has(realTargetPath)) return fileList;
  visitedDirectories.add(realTargetPath);

  const repositoryRealPath = fs.realpathSync(repositoryRoot);
  const relativeTarget = path.relative(repositoryRealPath, realTargetPath);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) return fileList;

  fs.readdirSync(realTargetPath)
    .sort()
    .forEach((item) => {
      const filePath = path.join(realTargetPath, item);
      let realFilePath: string;
      try {
        realFilePath = fs.realpathSync(filePath);
      } catch {
        return;
      }

      const relativeFile = path.relative(repositoryRealPath, realFilePath);
      if (relativeFile.startsWith('..') || path.isAbsolute(relativeFile)) return;

      const stats = fs.statSync(realFilePath);
      const extension = path.extname(item).toLowerCase();
      if (
        stats.isFile() &&
        (extension === '.yaml' || extension === '.yml') &&
        item !== 'template.yaml'
      ) {
        fileList.push(realFilePath);
      } else if (stats.isDirectory()) {
        readFileList(realFilePath, repositoryRealPath, fileList, visitedDirectories);
      }
    });

  return fileList;
};

export async function GetTemplateStatic() {
  try {
    const defaultKC = K8sApiDefault();
    const result = await defaultKC
      .makeApiClient(k8s.CoreV1Api)
      .readNamespacedConfigMap('template-static', 'template-frontend');

    const inputString = result?.body?.data?.['install-count'] || '';
    const installCountArray = inputString.split(/\n/).filter(Boolean);
    const temp: { [key: string]: number } = {};
    installCountArray.forEach((item) => {
      const match = item.trim().match(/^(\d+)\s(.+)$/);
      if (match) temp[match[2]] = parseInt(match[1], 10);
      else console.error(`Data format error: ${item}`);
    });
    return temp;
  } catch (error: any) {
    console.log('error: kubectl get configmap/template-static \n', error?.body);
    return {};
  }
}

export async function updateRepo() {
  const originalPath = process.cwd();
  const targetPath = path.resolve(originalPath, 'templates');
  const jsonPath = path.resolve(originalPath, 'templates.json');
  const config = Config();

  try {
    await execFileAsync('git', ['config', '--global', '--add', 'safe.directory', targetPath], {
      timeout: 10000
    });
    await cloneOrRefreshTemplateRepo(
      targetPath,
      config.template.repo.url,
      config.template.repo.branch
    );
    console.log('git operation: template repository refreshed');
  } catch (error) {
    // A failed refresh must not discard an already-valid catalog.
    console.log('git operation timed out (non-blocking): \n', error);
    if (error instanceof TemplateRepoCheckoutMismatchError) throw error;
  }

  if (!fs.existsSync(targetPath)) throw new Error('missing template repository file');

  const repositoryRoot = fs.realpathSync(targetPath);
  const targetPathFromConfig = path.resolve(targetPath, config.template.repo.localDir);
  const realTargetPath = fs.realpathSync(targetPathFromConfig);
  const relativeTargetPath = path.relative(repositoryRoot, realTargetPath);
  if (relativeTargetPath.startsWith('..') || path.isAbsolute(relativeTargetPath)) {
    throw new Error('template repository localDir escapes repository root');
  }

  const fileList = readFileList(realTargetPath, repositoryRoot);
  const templateStaticMap: { [key: string]: number } = await GetTemplateStatic();
  const jsonObjArr: unknown[] = [];

  fileList
    .filter((item) => !path.relative(realTargetPath, item).split(path.sep).includes('manifests'))
    .forEach((item) => {
      try {
        const fileName = path.basename(item);
        const content = fs.readFileSync(item, 'utf-8');
        let { templateYaml } = getYamlTemplate(content);
        templateYaml = resolveTemplateAssetUrls(templateYaml, {
          repo: config.template.repo,
          templateFilePath: item,
          repoRootPath: repositoryRoot
        });

        const appTitle = templateYaml.spec.title.toUpperCase();
        const currentCount = templateStaticMap[appTitle] || 0;
        const randomFactor = 11 + Math.floor(Math.random() * 5);
        templateYaml.spec['deployCount'] = (currentCount + 1) * randomFactor;
        templateYaml.spec['filePath'] = item;
        templateYaml.spec['fileName'] = fileName;
        jsonObjArr.push(templateYaml);
      } catch (error) {
        console.log(error, 'yaml parse error');
      }
    });

  writeFileAtomic(jsonPath, JSON.stringify(jsonObjArr, null, 2));
  syncTemplateCategoriesFromRepo(repositoryRoot, originalPath);
  readmeCache.clear();
  templateRepoLastSyncedAt = Date.now();
}

export async function ensureTemplateRepoFresh(basePath = process.cwd()) {
  const jsonPath = path.resolve(basePath, 'templates.json');
  const now = Date.now();
  const interval = getTemplateRepoSyncIntervalMs();

  if (
    fs.existsSync(jsonPath) &&
    templateRepoLastSyncedAt !== 0 &&
    now - templateRepoLastSyncedAt < interval
  ) {
    return;
  }

  if (!templateRepoSyncPromise) {
    templateRepoSyncPromise = updateRepo()
      .then(() => readmeCache.clear())
      .catch((error) => {
        if (!fs.existsSync(jsonPath) || error instanceof TemplateRepoCheckoutMismatchError) {
          throw error;
        }
        templateRepoLastSyncedAt = Date.now();
        console.warn(
          '[Template Repo] Failed to refresh repository, using existing catalog:',
          error
        );
      })
      .finally(() => {
        templateRepoSyncPromise = null;
      });
  }

  await templateRepoSyncPromise;
}
