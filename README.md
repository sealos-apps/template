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

```bash
pnpm dev
pnpm test:ci
pnpm test:components:ci
pnpm build
```

The package currently retains `workspace:^` references to shared Sealos frontend
packages. Standalone installation therefore requires those workspace packages to be
available, or a packaging step that replaces them with published/local snapshots.

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
order and derives Node TLS verification from the platform certificate mode.
