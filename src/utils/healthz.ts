import { getClientAppConfigServer } from '@/pages/api/platform/getClientAppConfig';

export const HEALTHZ_SERVICE = 'template';

export async function assertReady() {
  // Readiness validates the mounted app config without triggering Git I/O.
  await getClientAppConfigServer({ refreshRepo: false });
}
