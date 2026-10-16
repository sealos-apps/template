import type { HostConfig } from '@labring/sealos-desktop-sdk';
import { sealosApp } from '@labring/sealos-desktop-sdk/app';
import { create } from 'zustand';

type CurrencySymbol = NonNullable<HostConfig['currencySymbol']>;

export const useHostConfigStore = create<{
  currencySymbol: CurrencySymbol;
  loadHostConfig: () => Promise<void>;
}>((set) => ({
  currencySymbol: 'shellCoin',
  loadHostConfig: async () => {
    try {
      const { currencySymbol } = await sealosApp.getHostConfig();
      set({ currencySymbol: currencySymbol ?? 'shellCoin' });
    } catch {
      // Older Desktop hosts and standalone mode may not support this request.
      set({ currencySymbol: 'shellCoin' });
    }
  }
}));
