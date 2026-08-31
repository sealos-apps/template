import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushRybbitQueue, track } from '@/utils/analytics';

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
});

describe('analytics adapter', () => {
  it('keeps GTM dataLayer events and replays queued Rybbit events', () => {
    const dataLayer: unknown[] = [];
    const testWindow = { dataLayer } as unknown as Window & typeof globalThis;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: testWindow
    });

    track('guide_exit', {
      module: 'guide',
      guide_name: 'appstore',
      progress_step: 2
    });

    expect(dataLayer).toEqual([
      {
        event: 'guide_exit',
        context: 'app',
        module: 'guide',
        guide_name: 'appstore',
        progress_step: 2
      }
    ]);

    const rybbitEvent = vi.fn();
    testWindow.rybbit = { event: rybbitEvent };
    flushRybbitQueue();

    expect(rybbitEvent).toHaveBeenCalledWith('guide_exit', {
      context: 'app',
      module: 'guide',
      guide_name: 'appstore',
      progress_step: 2
    });
  });
});
