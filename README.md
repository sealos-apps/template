# Template App Store

The Template App Store is a Next.js service that indexes a Git template repository,
serves template details and README content, and provides the deployment APIs used by
the Sealos desktop application.

## Repository flow

At runtime the service keeps the configured template repository in `templates/` and
generates `templates.json`. A successful refresh also synchronizes a validated
`config/categories.json` from that repository to `template-categories.json`.

- `src/config.ts` and `src/types/config.ts` define the mounted `config.yaml` contract.
- `src/services/backend/template-repo.ts` validates the checkout remote and branch,
  refreshes it with a TTL and deduplicates concurrent refreshes.
- `src/pages/api/templateAsset.ts` serves validated image assets from the checkout;
  template icons are rewritten to this endpoint so repository-relative paths are not
  exposed to browsers.
- `src/pages/healthz.ts` is the deployment readiness endpoint and validates only the
  mounted application configuration.

## Local development

The development server reads `data/config.local.yaml` through the Next.js
instrumentation hook.

Install dependencies with the checked-in pnpm lockfile:

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm dev
pnpm test:ci
pnpm test:components:ci
pnpm build
```

The extracted app store uses the published Sealos SDK packages pinned in
`package.json`, so it can be installed outside the source monorepo. The Rybbit
analytics integration remains local because the published GTM SDK currently exposes
only the GTM dataLayer and GTM script component.

The repository `.npmrc` keeps npm installs compatible with the current shared SDK
metadata; pnpm remains the canonical package manager for the checked-in lockfile.

## API checkpoints

- `GET /healthz` and `HEAD /healthz`: return readiness as JSON or status only.
- `GET /api/listTemplate`: returns the catalog and menu keys.
- `GET /api/getTemplateSource?templateName=<name>`: returns rendered template data,
  optional README content and resource requirements.
- `GET /api/getTemplateReadme?templateName=<name>&locale=<locale>`: fetches README
  content independently from the deployment source response.
- `GET /api/templateAsset?path=<relative-path>`: serves only supported image types
  within the cloned template repository.

The v1, v1alpha and v2alpha template routes share the same refreshed catalog and
category cache while preserving their existing response shapes.

## Helm checks

```bash
helm lint deploy/charts/template-frontend
helm template template-frontend deploy/charts/template-frontend
bash -n deploy/template-frontend-entrypoint.sh
```

The chart keeps the `template-frontend` release identity, config mount at
`/app/data/config.yaml`, and existing App/Service/Ingress contracts. Its readiness
probe uses `/healthz` so repository refresh failures do not make a valid mounted
configuration look unready. Platform HTTP/HTTPS values are accepted at the chart
root (`cloudDomain`, `cloudPort`, `httpPort`, `disableHttps`, and `certSecretName`);
the legacy nested aliases remain supported. The entrypoint reads user overrides
from `/root/.sealos/cloud/values/apps/template-frontend/*-values.yaml` in sorted
order and derives Node TLS verification from the platform certificate mode. Existing
`/root/.sealos/cloud/values/core/template-frontend-values.yaml` values are loaded for
backward compatibility and copied into the canonical `apps` directory when needed.
