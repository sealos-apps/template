import { describe, expect, it } from 'vitest';
import { isTemplateRepoCheckoutCompatible } from '@/services/backend/template-repo';

describe('template repository checkout validation', () => {
  const configuredRepo = 'https://gogs.example.com/team/templates';

  it('accepts the configured remote and branch', () => {
    expect(
      isTemplateRepoCheckoutCompatible(
        `${configuredRepo}.git`,
        'main',
        configuredRepo,
        'main'
      )
    ).toBe(true);
  });

  it('rejects a different remote or branch', () => {
    expect(
      isTemplateRepoCheckoutCompatible(
        'https://gogs.example.com/other/templates',
        'main',
        configuredRepo,
        'main'
      )
    ).toBe(false);
    expect(
      isTemplateRepoCheckoutCompatible(configuredRepo, 'release', configuredRepo, 'main')
    ).toBe(false);
  });

  it('does not treat a non-Git directory as a validated checkout', () => {
    expect(isTemplateRepoCheckoutCompatible('', '', configuredRepo, 'main')).toBe(false);
  });
});
