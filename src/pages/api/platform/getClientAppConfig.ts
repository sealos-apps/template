import { Config } from '@/config';
import { jsonRes } from '@/services/backend/response';
import { isServerMisconfiguredError } from '@labring/sealos-shared-sdk/server/config';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ensureTemplateRepoFresh } from '@/services/backend/template-repo';
import { getTemplateCategories } from '@/services/backend/template-categories';
import { getClientAppConfigFromConfig } from '@/utils/clientAppConfig';

export async function getClientAppConfigServer({
  refreshRepo = true
}: { refreshRepo?: boolean } = {}) {
  if (refreshRepo) await ensureTemplateRepoFresh();
  const fullConfig = Config();
  return getClientAppConfigFromConfig(getTemplateCategories(fullConfig.template.categories));
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
