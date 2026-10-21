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

## CI publishing

Pushes to `main` automatically publish runtime and cluster images for
`linux/amd64` and `linux/arm64`, then upload both cluster archives and their MD5
files to OSS under `ci/main/<short-sha>/`. Pushes of `v*` tags upload under
`release/<tag>/`. These paths are relative to the repository variable `OSS_BUCKET`,
which includes the bucket name and the `offline/sealos-apps/template` prefix.

Manual workflow runs can enable `publish_images` to publish images or `upload_oss`
to publish images and upload archives. Pull requests do not publish or upload.
OSS uploads require the `OSS_ENDPOINT`, `OSS_ACCESS_KEY_ID`, and
`OSS_ACCESS_KEY_SECRET` secrets and the `OSS_BUCKET` repository variable.

## Helm checks

Price currency symbols come from Desktop through `sealosApp.getHostConfig()`
(`@labring/sealos-desktop-sdk` 0.1.24). Older hosts that omit the field and
standalone mode fall back to `shellCoin`. Upgrade Desktop before Template on
installations using another currency. Remove the former
`template.ui.currencySymbol` field from mounted configuration when upgrading;
the chart no longer generates it. The former template variable
`CURRENCY_SYMBOL` is also no longer supplied.

```bash
helm lint deploy/charts/template-frontend
helm template template-frontend deploy/charts/template-frontend
bash -n deploy/template-frontend-entrypoint.sh
```

The chart keeps the config mount at
`/app/data/config.yaml`, and existing App/Service/Ingress contracts. Its readiness
probe uses `/healthz` so repository refresh failures do not make a valid mounted
configuration look unready. Platform HTTP/HTTPS values are accepted at the chart
root (`cloudDomain`, `cloudPort`, `httpPort`, `disableHttps`, and `certSecretName`);
the legacy nested aliases remain supported. The entrypoint reads user overrides
from `/root/.sealos/cloud/values/apps/template/*-values.yaml` in sorted order and
derives Node TLS verification from the platform certificate mode.

### Retiring the legacy Template namespace

The installer deploys release `template` in `template-system` by default. Before
replacing the legacy `template-frontend` namespace, it saves its workload and
configuration manifests (including Secrets) to a mode-0600
`legacy-template-frontend-*.yaml.bak` file under
`/root/.sealos/cloud/values/apps/template/`. Retain any required legacy settings in
that directory's `*-values.yaml` before upgrading. In particular,
`templateConfig.templateRepoPath` is the directory **inside** the Git repository;
the default repository uses `template`, not `templates`.

Installation statistics are read from the Pod's service-account namespace, matching
the `template-static` CronJob's release namespace. Local development uses the active
kubeconfig context namespace, or Kubernetes' `default` namespace when unspecified.

Only after the new Deployment rolls out and every new Pod serves a non-empty
`/api/listTemplate` catalog does the installer delete the old namespace. A failed
deployment or catalog check keeps it intact. Cleanup skips an absent namespace or
one equal to `RELEASE_NAMESPACE`, and refuses automatic migration if the old
namespace contains PVCs or StatefulSets. Shared App and cluster RBAC resources are
adopted by the new release; the old Helm release is not uninstalled, because it
can still reference those shared resources. Gogs and user applications are outside
the legacy namespace and are preserved.

ConfigMap changes update the Deployment's `checksum/config` annotation, triggering
a new rollout so the mounted `config.yaml` and startup configuration are refreshed.
Git also follows `platform.tlsRejectUnauthorized`: `1` keeps certificate
verification enabled (`GIT_SSL_NO_VERIFY=false`, the chart default); `0` allows
platform self-signed repository certificates. The installer derives this existing
setting from the platform certificate mode. Override it through
`HELM_OPTS='--set-string platform.tlsRejectUnauthorized=1'`, or set
`GIT_SSL_NO_VERIFY` directly when running outside Helm (see `.env.template`).
Installer migration checks can be run without a cluster:

```bash
python3 deploy/tests/test_legacy_cleanup.py
```
