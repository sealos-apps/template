import { afterEach, describe, expect, it } from 'vitest';
import {
  clearTemplateCache,
  getCachedTemplateDetail,
  setCachedTemplateDetail
} from '@/pages/api/v2alpha/templates/templateCache';

afterEach(() => {
  clearTemplateCache();
});

describe('template detail cache', () => {
  it('evicts the oldest entries when the cache reaches its bound', () => {
    for (let index = 0; index <= 256; index++) {
      setCachedTemplateDetail(`detail-${index}`, { index });
    }

    expect(getCachedTemplateDetail('detail-0')).toBeNull();
    expect(getCachedTemplateDetail('detail-256')).toEqual({ index: 256 });
  });
});
