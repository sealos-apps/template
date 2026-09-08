import { jsonRes } from '@/services/backend/response';

import { TemplateType } from '@/types/app';
import fs from 'fs';
import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import { Config } from '@/config';
import { getTemplateCategories } from '@/services/backend/template-categories';
import { filterConfiguredCategorySlugs } from '@/utils/template';
import { ensureTemplateRepoFresh } from '@/services/backend/template-repo';
import { proxyTemplateIconUrls } from '@/utils/templateAsset';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const originalPath = process.cwd();
  const jsonPath = path.resolve(originalPath, 'templates.json');

  try {
    await ensureTemplateRepoFresh(originalPath);
    const config = Config();
    const categories = getTemplateCategories(config.template.categories);
    if (fs.existsSync(jsonPath)) {
      const jsonData = fs.readFileSync(jsonPath, 'utf8');
      const _templates: TemplateType[] = JSON.parse(jsonData);
      const templates = _templates
        .filter((item) => item?.spec?.draft !== true)
        .map((item) =>
          proxyTemplateIconUrls(
            {
              ...item,
              spec: {
                ...item.spec,
                categories: filterConfiguredCategorySlugs(item.spec.categories, categories)
              }
            },
            config.template.repo
          )
        );
      return jsonRes(res, { data: templates, code: 200 });
    } else {
      return jsonRes(res, { data: [], code: 200 });
    }
  } catch (error) {
    console.log(error);
    jsonRes(res, { code: 500, data: 'error' });
  }
}
