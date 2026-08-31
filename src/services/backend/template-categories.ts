import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { TemplateCategorySchema, type TemplateCategory } from '@/types/config';

export const DEFAULT_TEMPLATE_CATEGORIES_REPO_PATH = 'config/categories.json';
export const TEMPLATE_CATEGORIES_CACHE_FILE = 'template-categories.json';

const TemplateCategoriesSchema = z.array(TemplateCategorySchema);

function getConfiguredRepoCategoriesPath() {
  return process.env.TEMPLATE_CATEGORIES_PATH?.trim() || DEFAULT_TEMPLATE_CATEGORIES_REPO_PATH;
}

function normalizeRepoRelativePath(input: string) {
  const normalized = path.posix.normalize(input.replace(/\\/g, '/'));
  if (
    !normalized ||
    normalized === '.' ||
    path.posix.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`Invalid template categories path: ${input}`);
  }
  return normalized;
}

function resolveRepoContainedFile(repoRootPath: string, targetPath: string) {
  if (!fs.existsSync(targetPath)) return null;

  const repoRealPath = fs.realpathSync(repoRootPath);
  const targetStat = fs.lstatSync(targetPath);
  if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
    throw new Error(`Invalid template categories file: ${targetPath}`);
  }

  const targetRealPath = fs.realpathSync(targetPath);
  const relativePath = path.relative(repoRealPath, targetRealPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Template categories file escapes repository root: ${targetPath}`);
  }
  return targetRealPath;
}

export function getTemplateCategoriesCachePath(basePath = process.cwd()) {
  return path.resolve(basePath, TEMPLATE_CATEGORIES_CACHE_FILE);
}

export function resolveTemplateCategoriesRepoPath(repoRootPath: string) {
  const relativePath = normalizeRepoRelativePath(getConfiguredRepoCategoriesPath());
  return path.resolve(repoRootPath, ...relativePath.split('/'));
}

function parseTemplateCategories(content: string, source: string): TemplateCategory[] {
  const result = TemplateCategoriesSchema.safeParse(JSON.parse(content));
  if (!result.success) {
    throw new Error(`Invalid template categories in ${source}: ${result.error.message}`);
  }
  return result.data;
}

function readRegularFile(filePath: string) {
  const fileDescriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    if (!fs.fstatSync(fileDescriptor).isFile()) return null;
    return fs.readFileSync(fileDescriptor, 'utf-8');
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

export function readTemplateCategoriesFile(filePath: string): TemplateCategory[] | null {
  try {
    const content = readRegularFile(filePath);
    return content === null ? null : parseTemplateCategories(content, filePath);
  } catch (error) {
    console.warn('[Template Categories] Failed to read categories:', error);
    return null;
  }
}

export function readTemplateCategoriesFromRepo(repoRootPath: string): TemplateCategory[] | null {
  try {
    const categoriesPath = resolveRepoContainedFile(
      repoRootPath,
      resolveTemplateCategoriesRepoPath(repoRootPath)
    );
    return categoriesPath ? readTemplateCategoriesFile(categoriesPath) : null;
  } catch (error) {
    console.warn('[Template Categories] Failed to resolve categories path:', error);
    return null;
  }
}

function removeTemplateCategoriesCache(cachePath: string) {
  if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { force: true });
}

function writeTemplateCategoriesCache(cachePath: string, categories: TemplateCategory[]) {
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(categories, null, 2), {
      encoding: 'utf-8',
      flag: 'wx'
    });
    fs.renameSync(tempPath, cachePath);
  } catch (error) {
    removeTemplateCategoriesCache(cachePath);
    throw error;
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

export function syncTemplateCategoriesFromRepo(repoRootPath: string, basePath = process.cwd()) {
  const cachePath = getTemplateCategoriesCachePath(basePath);
  const categories = readTemplateCategoriesFromRepo(repoRootPath);
  if (!categories) {
    removeTemplateCategoriesCache(cachePath);
    return null;
  }

  writeTemplateCategoriesCache(cachePath, categories);
  return categories;
}

export function readTemplateCategoriesFromCache(basePath = process.cwd()) {
  const cachePath = getTemplateCategoriesCachePath(basePath);

  try {
    const content = readRegularFile(cachePath);
    if (content === null) {
      removeTemplateCategoriesCache(cachePath);
      return null;
    }
    return parseTemplateCategories(content, cachePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    removeTemplateCategoriesCache(cachePath);
    console.warn('[Template Categories] Failed to read cache categories:', error);
    return null;
  }
}

export function getTemplateCategories(
  fallbackCategories: TemplateCategory[] = [],
  basePath = process.cwd()
) {
  return readTemplateCategoriesFromCache(basePath) ?? fallbackCategories;
}

function getFileVersion(filePath: string) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return 'invalid';
    return `${stat.mtimeMs}-${stat.size}`;
  } catch {
    return 'missing';
  }
}

export function getTemplateCatalogVersion(basePath = process.cwd()) {
  return [
    getFileVersion(path.resolve(basePath, 'templates.json')),
    getFileVersion(getTemplateCategoriesCachePath(basePath))
  ].join('-');
}

export function createTemplateCatalogEtag(parts: readonly unknown[]) {
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify(parts))
    .digest('hex')
    .slice(0, 24);
  return `"template-${digest}"`;
}
