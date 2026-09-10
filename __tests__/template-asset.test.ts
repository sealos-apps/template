import { describe, expect, it } from 'vitest';
import { replaceRawWithCDN } from '@/pages/api/listTemplate';
import {
  getTemplateAssetProxyUrl,
  proxyTemplateIconUrls,
  resolveTemplateAssetUrl,
  resolveTemplateAssetUrls
} from '@/utils/templateAsset';
import type { TemplateType } from '@/types/app';

const repo = {
  url: 'https://github.com/labring-actions/templates',
  branch: 'main'
};

const repoRootPath = '/app/providers/template/templates';

function createTemplate(overrides: Partial<TemplateType['spec']> = {}): TemplateType {
  return {
    apiVersion: 'app.sealos.io/v1',
    kind: 'Template',
    metadata: { name: 'visible' },
    spec: {
      fileName: 'index.yaml',
      filePath: `${repoRootPath}/template/appsmith/index.yaml`,
      categories: ['low-code'],
      templateType: 'inline',
      gitRepo: 'https://github.com/appsmithorg/appsmith',
      author: '',
      title: 'Visible',
      url: '',
      readme: './README.md',
      icon: './static/logo.png',
      description: '',
      draft: false,
      ...overrides
    }
  };
}

describe('template asset URL resolution', () => {
  it('resolves GitHub template asset URLs relative to the template yaml directory', () => {
    expect(
      resolveTemplateAssetUrl({
        assetUrl: './README.md',
        repo,
        templateFilePath: `${repoRootPath}/template/appsmith/index.yaml`,
        repoRootPath
      })
    ).toBe(
      'https://raw.githubusercontent.com/labring-actions/templates/main/template/appsmith/README.md'
    );
  });

  it('resolves icon URLs for templates stored as a yaml file in a directory', () => {
    expect(
      resolveTemplateAssetUrl({
        assetUrl: './static/logo.png',
        repo,
        templateFilePath: `${repoRootPath}/template/appsmith.yaml`,
        repoRootPath
      })
    ).toBe(
      'https://raw.githubusercontent.com/labring-actions/templates/main/template/static/logo.png'
    );
  });

  it('keeps absolute URLs unchanged', () => {
    expect(
      resolveTemplateAssetUrl({
        assetUrl: 'https://example.com/logo.png',
        repo,
        templateFilePath: `${repoRootPath}/template/appsmith/index.yaml`,
        repoRootPath
      })
    ).toBe('https://example.com/logo.png');
  });

  it('does not resolve a relative asset outside the repository root', () => {
    expect(
      resolveTemplateAssetUrl({
        assetUrl: '../../../outside/logo.png',
        repo,
        templateFilePath: `${repoRootPath}/template/appsmith/index.yaml`,
        repoRootPath
      })
    ).toBe('../../../outside/logo.png');
  });

  it('resolves i18n readme and icon URLs', () => {
    const template = resolveTemplateAssetUrls(
      createTemplate({
        i18n: {
          en: {
            readme: './README_en.md',
            icon: './images/logo-en.png',
            description: 'English'
          }
        }
      }),
      {
        repo,
        templateFilePath: `${repoRootPath}/template/appsmith/index.yaml`,
        repoRootPath
      }
    );

    expect(template.spec.readme).toBe(
      'https://raw.githubusercontent.com/labring-actions/templates/main/template/appsmith/README.md'
    );
    expect(template.spec.icon).toBe(
      'https://raw.githubusercontent.com/labring-actions/templates/main/template/appsmith/static/logo.png'
    );
    expect(template.spec.i18n?.en.readme).toBe(
      'https://raw.githubusercontent.com/labring-actions/templates/main/template/appsmith/README_en.md'
    );
    expect(template.spec.i18n?.en.icon).toBe(
      'https://raw.githubusercontent.com/labring-actions/templates/main/template/appsmith/images/logo-en.png'
    );
  });

  it('keeps GitHub CDN replacement for resolved raw URLs', () => {
    const rawUrl = resolveTemplateAssetUrl({
      assetUrl: './README.md',
      repo,
      templateFilePath: `${repoRootPath}/template/appsmith/index.yaml`,
      repoRootPath
    });

    expect(replaceRawWithCDN(rawUrl, 'cdn.jsdelivr.net')).toBe(
      'https://cdn.jsdelivr.net/gh/labring-actions/templates@main/template/appsmith/README.md'
    );
  });

  it('uses the local proxy for repository icons and preserves i18n icons', () => {
    const template = proxyTemplateIconUrls(
      createTemplate({
        icon: 'https://gogs.example.com/team/templates/raw/main/app/static/logo.svg',
        i18n: {
          zh: {
            icon: 'https://gogs.example.com/team/templates/raw/main/app/static/logo-zh.png'
          }
        }
      }),
      { url: 'https://gogs.example.com/team/templates', branch: 'main' }
    );

    expect(template.spec.icon).toBe('/api/templateAsset?path=app%2Fstatic%2Flogo.svg');
    expect(template.spec.i18n?.zh.icon).toBe('/api/templateAsset?path=app%2Fstatic%2Flogo-zh.png');
  });

  it('does not proxy another branch or traversal-like icon path', () => {
    const repoUrl = { url: 'https://gogs.example.com/team/templates', branch: 'main' };
    expect(
      getTemplateAssetProxyUrl(
        'https://gogs.example.com/team/templates/raw/release/app/logo.svg',
        repoUrl
      )
    ).toContain('/raw/release/');
    expect(
      getTemplateAssetProxyUrl(
        'https://gogs.example.com/team/templates/raw/main/%2e%2e/secret/logo.svg',
        repoUrl
      )
    ).toBe('https://gogs.example.com/team/templates/raw/main/%2e%2e/secret/logo.svg');
  });

  it('does not proxy a matching repository path from another origin', () => {
    const repoUrl = { url: 'https://gogs.example.com/team/templates', branch: 'main' };
    const assetUrl = 'https://untrusted.example.com/team/templates/raw/main/app/logo.svg';

    expect(getTemplateAssetProxyUrl(assetUrl, repoUrl)).toBe(assetUrl);
  });

  it('does not proxy a browser-facing URL when the repository is cloned internally', () => {
    const repoUrl = {
      url: 'http://template-gogs.template-system.svc.cluster.local:3000/sealos-admin/templates.git',
      branch: 'main'
    };

    expect(
      getTemplateAssetProxyUrl(
        'https://gogs.example.com/sealos-admin/templates/raw/main/template/ace-step/logo.svg',
        repoUrl
      )
    ).toBe('https://gogs.example.com/sealos-admin/templates/raw/main/template/ace-step/logo.svg');
  });
});
