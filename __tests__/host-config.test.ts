import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostConfig } from '@labring/sealos-desktop-sdk';

const { getHostConfig } = vi.hoisted(() => ({ getHostConfig: vi.fn() }));
vi.mock('@labring/sealos-desktop-sdk/app', () => ({
  sealosApp: { getHostConfig }
}));

import { useHostConfigStore } from '@/store/hostConfig';

describe('Desktop currency configuration', () => {
  beforeEach(() => {
    getHostConfig.mockReset();
    useHostConfigStore.setState({ currencySymbol: 'shellCoin' });
  });

  it.each(['shellCoin', 'cny', 'usd'] as const)(
    'uses Desktop currency %s',
    async (currencySymbol) => {
      getHostConfig.mockResolvedValue({ currencySymbol } satisfies Partial<HostConfig>);

      await useHostConfigStore.getState().loadHostConfig();

      expect(useHostConfigStore.getState().currencySymbol).toBe(currencySymbol);
    }
  );

  it('falls back when an older Desktop omits the currency', async () => {
    useHostConfigStore.setState({ currencySymbol: 'usd' });
    getHostConfig.mockResolvedValue({});

    await useHostConfigStore.getState().loadHostConfig();

    expect(useHostConfigStore.getState().currencySymbol).toBe('shellCoin');
  });

  it('falls back when the host request fails', async () => {
    getHostConfig.mockRejectedValue(new Error('Desktop unavailable'));

    await useHostConfigStore.getState().loadHostConfig();

    expect(useHostConfigStore.getState().currencySymbol).toBe('shellCoin');
  });
});
