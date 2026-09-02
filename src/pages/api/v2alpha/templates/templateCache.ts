import { readTemplatesFromFile } from '../../listTemplate';
import { TemplateType } from '@/types/app';
import type { TemplateCategory } from '@/types/config';
import type { TemplateRepo } from '@/utils/templateAsset';

interface TemplatesCache {
  data: TemplateType[];
  timestamp: number;
  map: Map<string, TemplateType>;
  cacheKey: string;
}

interface TemplateDetailCache {
  data: any;
  timestamp: number;
}

let templatesCache: TemplatesCache | null = null;
let templateDetailCache = new Map<string, TemplateDetailCache>();
let isRefreshingCache = false;
const CACHE_TTL = 5 * 60 * 1000;
const MAX_TEMPLATE_DETAIL_CACHE_SIZE = 256;

function removeExpiredTemplateDetails(now: number) {
  for (const [key, cached] of templateDetailCache) {
    if (now - cached.timestamp >= CACHE_TTL) templateDetailCache.delete(key);
  }
}

export function getCachedTemplates(
  jsonPath: string,
  cdnUrl?: string,
  configuredCategories: TemplateCategory[] = [],
  language?: string,
  templateRepo?: TemplateRepo,
  catalogVersion = ''
) {
  const now = Date.now();
  const cacheKey = JSON.stringify([
    jsonPath,
    cdnUrl,
    configuredCategories.map((category) => [category.slug, category.i18n]),
    language,
    templateRepo,
    catalogVersion
  ]);

  if (
    templatesCache &&
    templatesCache.cacheKey === cacheKey &&
    now - templatesCache.timestamp < CACHE_TTL
  ) {
    return templatesCache;
  }

  if (isRefreshingCache && templatesCache?.cacheKey === cacheKey) return templatesCache;

  try {
    isRefreshingCache = true;

    const templates = readTemplatesFromFile(
      jsonPath,
      cdnUrl,
      configuredCategories,
      language,
      templateRepo
    );
    const templateMap = new Map<string, TemplateType>();

    templates.forEach((template) => {
      templateMap.set(template.metadata.name, template);
    });

    templatesCache = {
      data: templates,
      timestamp: now,
      map: templateMap,
      cacheKey
    };

    return templatesCache;
  } finally {
    isRefreshingCache = false;
  }
}

// Get specific template from cache
export function getTemplateFromCache(templateName: string): TemplateType | undefined {
  if (!templatesCache) {
    return undefined;
  }
  return templatesCache.map.get(templateName);
}

// Get cached template detail
export function getCachedTemplateDetail(cacheKey: string): any | null {
  const cached = templateDetailCache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  if (cached) templateDetailCache.delete(cacheKey);
  return null;
}

// Set template detail cache
export function setCachedTemplateDetail(cacheKey: string, data: any): void {
  const now = Date.now();
  removeExpiredTemplateDetails(now);
  if (templateDetailCache.has(cacheKey)) templateDetailCache.delete(cacheKey);
  while (templateDetailCache.size >= MAX_TEMPLATE_DETAIL_CACHE_SIZE) {
    const oldestKey = templateDetailCache.keys().next().value;
    if (oldestKey === undefined) break;
    templateDetailCache.delete(oldestKey);
  }
  templateDetailCache.set(cacheKey, {
    data,
    timestamp: now
  });
}

// Clear all caches
export function clearTemplateCache(): void {
  templatesCache = null;
  templateDetailCache.clear();
}
