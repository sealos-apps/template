import fs from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readConfigMap, getContextObject } = vi.hoisted(() => ({
  readConfigMap: vi.fn(),
  getContextObject: vi.fn()
}));

vi.mock('@/services/backend/kubernetes', () => ({
  K8sApiDefault: () => ({
    makeApiClient: () => ({ readNamespacedConfigMap: readConfigMap }),
    getCurrentContext: () => 'local',
    getContextObject
  })
}));

import { GetTemplateStatic } from '@/services/backend/template-repo';

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('template installation statistics', () => {
  it.each(['template-system', 'custom-template'])(
    'reads statistics from Pod namespace %s',
    async (namespace) => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(`${namespace}\n`);
      readConfigMap.mockResolvedValue({
        body: { data: { 'install-count': '12 WORDPRESS\n3 POSTGRES\n' } }
      });

      expect(await GetTemplateStatic()).toEqual({ WORDPRESS: 12, POSTGRES: 3 });
      expect(readConfigMap).toHaveBeenCalledWith('template-static', namespace);
      expect(fs.readFileSync).toHaveBeenCalledWith(
        '/var/run/secrets/kubernetes.io/serviceaccount/namespace',
        'utf8'
      );
    }
  );

  it('uses the kubeconfig context namespace outside a Pod', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    getContextObject.mockReturnValue({ namespace: 'local-template' });
    readConfigMap.mockResolvedValue({ body: { data: { 'install-count': '2 WORDPRESS' } } });

    expect(await GetTemplateStatic()).toEqual({ WORDPRESS: 2 });
    expect(readConfigMap).toHaveBeenCalledWith('template-static', 'local-template');
  });

  it('uses the Kubernetes default namespace when the context has none', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    getContextObject.mockReturnValue(undefined);
    readConfigMap.mockResolvedValue({ body: { data: {} } });

    expect(await GetTemplateStatic()).toEqual({});
    expect(readConfigMap).toHaveBeenCalledWith('template-static', 'default');
  });

  it('keeps template refresh available if statistics have not been generated yet', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue('template-system');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    readConfigMap.mockRejectedValue({ body: { code: 404 } });

    expect(await GetTemplateStatic()).toEqual({});
    expect(readConfigMap).toHaveBeenCalledWith('template-static', 'template-system');
  });
});
