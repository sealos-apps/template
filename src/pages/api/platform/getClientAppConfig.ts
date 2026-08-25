import { Config } from '@/config';
import { jsonRes } from '@/services/backend/response';
import { ClientAppConfigSchema } from '@/types/config';
import {
  isServerMisconfiguredError,
  validateClientAppConfigOrThrow
} from '@sealos/shared/server/config';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureTemplateRepoFresh } from '@/services/backend/template-repo';
import { getTemplateCategories } from '@/services/backend/template-categories';

export async function getClientAppConfigServer({
  refreshRepo = true
}: { refreshRepo?: boolean } = {}) {
  if (refreshRepo) await ensureTemplateRepoFresh();
  const fullConfig = Config();
  return validateClientAppConfigOrThrow(ClientAppConfigSchema, {
    brandName: fullConfig.template.ui.brandName,
    desktopDomain: fullConfig.template.desktopDomain,
    currencySymbol: fullConfig.template.ui.currencySymbol,
    categories: getTemplateCategories(fullConfig.template.categories),
    showAuthor: fullConfig.template.features.showAuthor,
    carousel: fullConfig.template.ui.carousel
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    jsonRes(res, {
      code: 200,
      data: await getClientAppConfigServer()
    });
  } catch (error) {
    if (isServerMisconfiguredError(error)) {
      return jsonRes(res, { code: 500, message: 'Server misconfigured' });
    }
    console.error('[Client App Config] Unexpected server error:', error);
    return jsonRes(res, { code: 500, message: 'Internal Server Error' });
  }
}
