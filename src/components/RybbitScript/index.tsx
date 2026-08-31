'use client';

import Script from 'next/script';
import { flushRybbitQueue } from '@/utils/analytics';

export interface RybbitScriptProps {
  host: string;
  siteId: string;
  debug?: boolean;
}

export default function RybbitScript({ host, siteId, debug = false }: RybbitScriptProps) {
  if (debug) {
    console.log('[Sealos Rybbit] host:', host, 'site ID:', siteId);
  }

  if (!host || !siteId) {
    return null;
  }

  return (
    <Script
      id="rybbit-script"
      strategy="afterInteractive"
      src={`${host.replace(/\/+$/, '')}/api/script.js`}
      data-site-id={siteId}
      onLoad={flushRybbitQueue}
    />
  );
}
