import { authSession } from '@/services/backend/auth';
import { getK8s } from '@/services/backend/kubernetes';
import { jsonRes } from '@/services/backend/response';
import type { NextApiRequest, NextApiResponse } from 'next';
import { GetTemplateReadmeByName } from './getTemplateSource';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { templateName, locale = 'en' } = req.query as {
      templateName: string;
      locale: string;
    };

    let namespace = '';
    try {
      namespace = (await getK8s({ kubeconfig: await authSession(req.headers) })).namespace;
    } catch {}

    const result = await GetTemplateReadmeByName({ namespace, templateName, locale });
    if (result.code !== 20000) return jsonRes(res, { code: result.code, message: result.message });

    return jsonRes(res, {
      code: 200,
      data: { readmeContent: result.readmeContent, readUrl: result.readUrl }
    });
  } catch (error: any) {
    return jsonRes(res, { code: 500, error });
  }
}
