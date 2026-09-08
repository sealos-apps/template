import { describe, expect, it } from 'vitest';
import { getTemplateCatalogEntry } from '@/pages/api/getTemplateSource';
import type { TemplateType } from '@/types/app';

function template(name: string) {
  return {
    metadata: { name },
    spec: { fileName: `${name}.yaml`, filePath: `/templates/${name}.yaml` }
  } as TemplateType;
}

describe('template source catalog lookup', () => {
  it('returns only templates declared in the catalog', () => {
    const visible = template('visible');
    expect(getTemplateCatalogEntry([visible], 'visible')).toBe(visible);
  });

  it('rejects an unknown template instead of deriving a file path from the request', () => {
    expect(() => getTemplateCatalogEntry([template('visible')], 'secret')).toThrow(
      "Template 'secret' not found"
    );
    expect(() => getTemplateCatalogEntry([template('visible')], 'secret')).toThrowError(
      expect.objectContaining({ code: 'ENOENT' })
    );
  });
});
