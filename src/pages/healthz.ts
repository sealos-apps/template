import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import { assertReady, HEALTHZ_SERVICE } from '@/utils/healthz';

export const getServerSideProps: GetServerSideProps = async ({ req, res }) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return { props: {} };
  }

  const head = req.method === 'HEAD';
  try {
    await assertReady();
    if (head) res.statusCode = 200;
    else sendJson(res, 200, { status: 'ok', service: HEALTHZ_SERVICE });
  } catch (error) {
    console.error(`[healthz] ${HEALTHZ_SERVICE} is not ready`, error);
    if (head) res.statusCode = 503;
    else sendJson(res, 503, { status: 'error', service: HEALTHZ_SERVICE });
  }

  if (head) res.end();
  return { props: {} };
};

function sendJson(
  res: GetServerSidePropsContext['res'],
  statusCode: number,
  body: Record<string, string>
) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export default function Healthz() {
  return null;
}
