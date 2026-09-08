import { authSession } from '@/services/backend/auth';
import { getK8s } from '@/services/backend/kubernetes';
import { jsonRes } from '@/services/backend/response';
import { TemplateType } from '@/types/app';
import {
  getTemplateDataSource,
  handleTemplateToInstanceYaml,
  getYamlTemplate,
  parseTemplateVariable
} from '@/utils/json-yaml';
import fs from 'fs';
import JsYaml from 'js-yaml';
import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import { replaceRawWithCDN } from './listTemplate';
import { getTemplateEnvs } from '@/utils/common';
import { getResourceUsage, ResourceUsage } from '@/utils/usage';
import {
  filterConfiguredCategorySlugs,
  generateYamlData,
  getTemplateDefaultValues
} from '@/utils/template';
import { readmeCache } from '@/utils/readmeCache';
import {
  proxyTemplateIconUrls,
  resolveTemplateAssetUrls,
  type TemplateRepo
} from '@/utils/templateAsset';
import { appendTemplateManifestSources } from '@/services/backend/template-manifests';
import { getTemplateCategories } from '@/services/backend/template-categories';
import { ensureTemplateRepoFresh } from '@/services/backend/template-repo';
import { Config } from '@/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const queryIncludeReadme = req.query.includeReadme !== 'false';
    const config = Config();
    const includeReadme =
      !config.template.features.fetchReadme || !queryIncludeReadme ? 'false' : 'true';
    const includeRequirements = req.query.includeRequirements !== 'false';

    const { templateName, locale = 'en' } = req.query as {
      templateName: string;
      locale: string;
    };

    let user_namespace = '';
    try {
      const { namespace } = await getK8s({
        kubeconfig: await authSession(req.headers)
      });
      user_namespace = namespace;
    } catch {}

    const result = await GetTemplateByName({
      namespace: user_namespace,
      templateName,
      locale,
      includeReadme
    });

    if (result.code !== 20000) return jsonRes(res, { code: result.code, message: result.message });
    if (!result.appYaml || !templateName || !result.templateYaml || !result.TemplateEnvs) {
      return jsonRes(res, { code: 400, message: 'Invalid template request!' });
    }

    const templateSource = {
      source: {
        ...result.dataSource,
        ...result.TemplateEnvs
      },
      appYaml: result.appYaml,
      templateYaml: result.templateYaml,
      readmeContent: result.readmeContent,
      readUrl: result.readUrl
    };

    let requirements: ResourceUsage | null = null;
    if (includeRequirements) {
      try {
        const platformEnvs = getTemplateEnvs(user_namespace);
        const renderedYaml = generateYamlData(
          templateSource,
          getTemplateDefaultValues(templateSource),
          platformEnvs
        );
        requirements = getResourceUsage(renderedYaml.map((item) => item.value));
      } catch {
        console.error('Error getting default resource requirements for template');
      }
    }

    jsonRes(res, {
      code: 200,
      data: {
        ...templateSource,
        requirements
      }
    });
  } catch {
    console.error('[Template Source] Failed to load template source');
    jsonRes(res, { code: 500, message: 'Internal Server Error' });
  }
}

export async function GetTemplateByName({
  namespace,
  templateName,
  locale = 'en',
  includeReadme = 'false'
}: {
  namespace: string;
  templateName: string;
  locale?: string;
  includeReadme?: string;
}) {
  await ensureTemplateRepoFresh();

  const config = Config();
  const categories = getTemplateCategories(config.template.categories);
  const TemplateEnvs = getTemplateEnvs(namespace);
  const templateRepo: TemplateRepo = config.template.repo;

  let appYaml: string;
  let templateYaml: TemplateType;
  try {
    ({ appYaml, templateYaml } = getTemplateYamlByName(templateName, templateRepo));
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      return { code: 40400, message: `Template '${templateName}' not found` };
    }
    throw error;
  }

  templateYaml.spec.categories = filterConfiguredCategorySlugs(
    templateYaml.spec.categories,
    categories
  );
  templateYaml = proxyTemplateIconUrls(
    parseTemplateVariable(templateYaml, TemplateEnvs),
    templateRepo
  );

  const dataSource = getTemplateDataSource(templateYaml);
  const instanceName = dataSource?.defaults?.['app_name']?.value;
  if (!instanceName) return { code: 40000, message: 'default app_name is missing' };

  const instanceYaml = handleTemplateToInstanceYaml(templateYaml, instanceName);
  appYaml = `${JsYaml.dump(instanceYaml)}\n---\n${appYaml}`;

  let readmeContent = '';
  let readUrl = '';
  if (includeReadme === 'true') {
    readUrl = templateYaml?.spec?.i18n?.[locale]?.readme || templateYaml?.spec?.readme || '';
    if (readUrl) readmeContent = await fetchReadmeContentWithRetry(readUrl);
  }

  return {
    code: 20000,
    message: 'success',
    dataSource,
    TemplateEnvs,
    appYaml,
    templateYaml,
    readmeContent,
    readUrl
  };
}

export async function GetTemplateReadmeByName({
  namespace,
  templateName,
  locale = 'en'
}: {
  namespace: string;
  templateName: string;
  locale?: string;
}) {
  const config = Config();
  if (!config.template.features.fetchReadme) {
    return { code: 20000, message: 'success', readmeContent: '', readUrl: '' };
  }

  await ensureTemplateRepoFresh();
  let templateYaml: TemplateType;
  try {
    templateYaml = getTemplateYamlByName(templateName, config.template.repo).templateYaml;
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
      return { code: 40400, message: `Template '${templateName}' not found` };
    }
    throw error;
  }
  const parsedTemplate = parseTemplateVariable(templateYaml, getTemplateEnvs(namespace));
  const readUrl =
    parsedTemplate?.spec?.i18n?.[locale]?.readme || parsedTemplate?.spec?.readme || '';
  return {
    code: 20000,
    message: 'success',
    readmeContent: readUrl ? await fetchReadmeContentWithRetry(readUrl) : '',
    readUrl
  };
}

function getTemplateYamlByName(templateName: string, templateRepo: TemplateRepo) {
  const config = Config();
  const originalPath = process.cwd();
  const repoRootPath = path.resolve(originalPath, 'templates');
  const targetPath = path.resolve(repoRootPath, config.template.repo.localDir);
  const jsonPath = path.resolve(originalPath, 'templates.json');
  const jsonData: TemplateType[] = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const template = getTemplateCatalogEntry(jsonData, templateName);
  const candidatePath = template.spec.filePath || path.resolve(targetPath, template.spec.fileName);
  const repositoryRoot = fs.realpathSync(repoRootPath);
  const templateRoot = fs.realpathSync(targetPath);
  const templateFilePath = fs.realpathSync(candidatePath);
  const relativePath = path.relative(repositoryRoot, templateFilePath);
  const relativeTemplatePath = path.relative(templateRoot, templateFilePath);
  if (
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath) ||
    relativeTemplatePath.startsWith('..') ||
    path.isAbsolute(relativeTemplatePath)
  ) {
    throw new Error(`Template path escapes repository root: ${candidatePath}`);
  }

  const yamlString = fs.readFileSync(templateFilePath, 'utf-8');
  const parsed = getYamlTemplate(yamlString);
  const appYaml = appendTemplateManifestSources(parsed.appYaml, templateFilePath, repositoryRoot);
  let templateYaml = resolveTemplateAssetUrls(parsed.templateYaml, {
    repo: templateRepo,
    templateFilePath,
    repoRootPath: repositoryRoot
  });
  templateYaml.spec.deployCount = template?.spec?.deployCount;

  if (config.template.cdnHost) {
    templateYaml.spec.readme = replaceRawWithCDN(templateYaml.spec.readme, config.template.cdnHost);
    templateYaml.spec.icon = replaceRawWithCDN(templateYaml.spec.icon, config.template.cdnHost);
    Object.values(templateYaml.spec.i18n || {}).forEach((i18nData) => {
      ['readme', 'icon'].forEach((field) => {
        if (i18nData?.[field]) {
          i18nData[field] = replaceRawWithCDN(i18nData[field], config.template.cdnHost!);
        }
      });
    });
  }

  return { appYaml, templateYaml };
}

export function getTemplateCatalogEntry(templates: readonly TemplateType[], templateName: string) {
  const template = templates.find((item) => item.metadata.name === templateName);
  if (template) return template;

  const error = new Error(`Template '${templateName}' not found`);
  (error as NodeJS.ErrnoException).code = 'ENOENT';
  throw error;
}

async function fetchReadmeContentWithRetry(url: string): Promise<string> {
  if (!url) return '';
  const cachedContent = readmeCache.get(url);
  if (cachedContent !== null) return cachedContent;

  const maxRetries = 3;
  for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/markdown,text/plain,*/*',
          'Content-Type': 'text/markdown; charset=UTF-8',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          'User-Agent': 'Mozilla/5.0'
        },
        credentials: 'omit'
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const content = await response.text();
      readmeCache.set(url, content);
      return content;
    } catch (error) {
      if (retryCount === maxRetries - 1) {
        console.log(`Failed to fetch README after ${maxRetries} attempts`);
        return '';
      }
      await new Promise((resolve) => setTimeout(resolve, (retryCount + 1) * 1000));
    }
  }
  return '';
}
