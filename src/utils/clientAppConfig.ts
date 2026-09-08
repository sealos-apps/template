import { Config } from '@/config';
import { ClientAppConfigSchema, type ClientAppConfig, type TemplateCategory } from '@/types/config';
import { validateClientAppConfigOrThrow } from '@labring/sealos-shared-sdk/server/config';

/**
 * Build the configuration exposed to the browser from the server-mounted app config.
 * Keep this module free of filesystem and Kubernetes dependencies because _app.tsx imports it.
 */
export function getClientAppConfigFromConfig(categories?: TemplateCategory[]): ClientAppConfig {
  const fullConfig = Config();

  return validateClientAppConfigOrThrow(ClientAppConfigSchema, {
    brandName: fullConfig.template.ui.brandName,
    desktopDomain: fullConfig.template.desktopDomain,
    currencySymbol: fullConfig.template.ui.currencySymbol,
    categories: categories ?? fullConfig.template.categories,
    showAuthor: fullConfig.template.features.showAuthor,
    carousel: fullConfig.template.ui.carousel
  });
}
