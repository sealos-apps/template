#!/bin/bash
set -e

# ============================================================================
# template-frontend entrypoint
#
# Upgrades any legacy `template-frontend` Helm release living in the legacy
# `template-frontend` namespace, then installs/upgrades the current chart
# into the `template-system` namespace.
#
# Migration behaviour:
#   - If a Helm release named ${RELEASE_NAME} exists in ${LEGACY_RELEASE_NAMESPACE},
#     it is uninstalled first. This is required because Helm cannot move a
#     release across namespaces in-place.
#   - The legacy namespace is removed afterwards (opt-out via CLEANUP_LEGACY_NS=false).
#   - User-supplied values at /root/.sealos/cloud/values/apps/template/*.yaml are
#     honoured. Legacy field names from previous charts are translated to the
#     current schema before being passed to Helm.
# ============================================================================

RELEASE_NAME=${RELEASE_NAME:-"template"}
RELEASE_NAMESPACE=${RELEASE_NAMESPACE:-"template-system"}
LEGACY_RELEASE_NAME=${LEGACY_RELEASE_NAME:-"template-frontend"}
LEGACY_RELEASE_NAMESPACE=${LEGACY_RELEASE_NAMESPACE:-"template-frontend"}
CLEANUP_LEGACY_NS=${CLEANUP_LEGACY_NS:-"true"}
CHART_PATH=${CHART_PATH:-"./charts/template-frontend"}
HELM_OPTS=${HELM_OPTS:-""}
HELM_OPTIONS=${HELM_OPTIONS:-""}
AUTO_CONFIG_HELM_OPTS=""
TOOLS_FILE=${TOOLS_FILE:-"/root/.sealos/cloud/scripts/tools.sh"}

if [ -f "${TOOLS_FILE}" ]; then
  if [ "${TOOLS_FILE}" = "/root/.sealos/cloud/scripts/tools.sh" ]; then
    # shellcheck source=/root/.sealos/cloud/scripts/tools.sh
    source /root/.sealos/cloud/scripts/tools.sh
  else
    source "${TOOLS_FILE}"
  fi
else
  echo "Warning: platform tools file not found at ${TOOLS_FILE}; platform defaults must be supplied explicitly." >&2
fi

# Older platform images may not ship tools.sh. Keep environment-provided
# values usable and make the ConfigMap lookup an optional fallback without
# shadowing the platform helper when it is available.
read_platform_config_value() {
  local namespace="$1"
  local name="$2"
  local key="$3"
  if declare -F get_cm_value >/dev/null 2>&1; then
    get_cm_value "${namespace}" "${name}" "${key}" || true
  elif command -v kubectl >/dev/null 2>&1; then
    kubectl get configmap "${name}" -n "${namespace}" -o "jsonpath={.data.${key}}" 2>/dev/null || true
  fi
}

add_set_string() {
  local key="$1"
  local value="$2"
  if [ -n "${value}" ]; then
    AUTO_CONFIG_HELM_OPTS="${AUTO_CONFIG_HELM_OPTS} --set-string ${key}=${value}"
  fi
}

GLOBAL_HTTP_EXTERNAL_URL="$(global_http_external_url 2>/dev/null || true)"
SEALOS_CLOUD_DOMAIN=${SEALOS_CLOUD_DOMAIN:-"${cloudDomain:-$(read_platform_config_value sealos-system sealos-config cloudDomain)}"}
if [ -z "${SEALOS_CLOUD_DOMAIN}" ] && [ -n "${GLOBAL_HTTP_EXTERNAL_URL}" ]; then
  SEALOS_CLOUD_DOMAIN="${GLOBAL_HTTP_EXTERNAL_URL#*://}"
  SEALOS_CLOUD_DOMAIN="${SEALOS_CLOUD_DOMAIN%%/*}"
  SEALOS_CLOUD_DOMAIN="${SEALOS_CLOUD_DOMAIN%%:*}"
fi
add_set_string templateConfig.cloudDomain "${SEALOS_CLOUD_DOMAIN}"
add_set_string cloudDomain "${SEALOS_CLOUD_DOMAIN}"
SEALOS_CLOUD_PORT=${SEALOS_CLOUD_PORT:-"${cloudPort:-$(read_platform_config_value sealos-system sealos-config cloudPort)}"}
add_set_string templateConfig.cloudPort "${SEALOS_CLOUD_PORT}"
add_set_string cloudPort "${SEALOS_CLOUD_PORT}"
SEALOS_HTTP_PORT=${SEALOS_HTTP_PORT:-"${httpPort:-$(read_platform_config_value sealos-system sealos-config httpPort)}"}
add_set_string templateConfig.httpPort "${SEALOS_HTTP_PORT}"
add_set_string httpPort "${SEALOS_HTTP_PORT}"
SEALOS_DISABLE_HTTPS=${SEALOS_DISABLE_HTTPS:-"${disableHttps:-$(read_platform_config_value sealos-system sealos-config disableHttps)}"}
add_set_string templateConfig.disableHttps "${SEALOS_DISABLE_HTTPS}"
add_set_string disableHttps "${SEALOS_DISABLE_HTTPS}"
SEALOS_CERT_SECRET_NAME=${SEALOS_CERT_SECRET_NAME:-"${certSecretName:-$(read_platform_config_value sealos-system sealos-config certSecretName)}"}
add_set_string templateConfig.certSecretName "${SEALOS_CERT_SECRET_NAME}"
add_set_string certSecretName "${SEALOS_CERT_SECRET_NAME}"

TLS_REJECT_UNAUTHORIZED="$(read_cert_tls_reject_unauthorized 2>/dev/null || true)"
if [ -z "${TLS_REJECT_UNAUTHORIZED}" ]; then
  CERT_MODE=${CERT_MODE:-"$(kubectl get configmap cert-config -n sealos-system -o 'jsonpath={.data.CERT_MODE}' 2>/dev/null || true)"}
  TLS_REJECT_UNAUTHORIZED=1
  case "${CERT_MODE}" in
    https|acme)
      TLS_REJECT_UNAUTHORIZED=0
      ;;
  esac
fi
# Helm --set-string platform.tlsRejectUnauthorized=${TLS_REJECT_UNAUTHORIZED}
AUTO_CONFIG_HELM_OPTS="${AUTO_CONFIG_HELM_OPTS} --set-string platform.tlsRejectUnauthorized=${TLS_REJECT_UNAUTHORIZED}"

# ----------------------------------------------------------------------------
# Inherit values from any legacy release BEFORE uninstalling it. This lets
# upgrades carry forward operator-tuned fields (like templateRepoUrl) that
# were originally supplied via --set and never written back to the user
# values files. Explicit environment variables always win.
# ----------------------------------------------------------------------------
inherit_legacy_value() {
  # inherit_legacy_value <yaml.path.in.release.values> <env-var-value>
  # Echoes the env-var value if set, otherwise the value pulled from the
  # legacy release, otherwise empty.
  local path="$1"
  local env_value="$2"
  if [ -n "${env_value}" ]; then
    printf '%s' "${env_value}"
    return 0
  fi
  if [ -z "${LEGACY_RELEASE_VALUES_YAML}" ]; then
    return 0
  fi
  # Use python (always present on sealos images) to walk the YAML path safely.
  python3 - "${LEGACY_RELEASE_VALUES_YAML}" "${path}" <<'PY' 2>/dev/null || true
import sys, yaml
path_file, dotted = sys.argv[1], sys.argv[2]
try:
    with open(path_file) as f:
        data = yaml.safe_load(f) or {}
except Exception:
    sys.exit(0)
cur = data
for part in dotted.split('.'):
    if not isinstance(cur, dict) or part not in cur:
        sys.exit(0)
    cur = cur[part]
if cur is None or isinstance(cur, (dict, list)):
    sys.exit(0)
sys.stdout.write(str(cur))
PY
}

LEGACY_RELEASE_VALUES_YAML=""
if command -v helm >/dev/null 2>&1 \
   && [ "${LEGACY_RELEASE_NAMESPACE}" != "${RELEASE_NAMESPACE}" -o "${LEGACY_RELEASE_NAME}" != "${RELEASE_NAME}" ] \
   && helm status "${LEGACY_RELEASE_NAME}" -n "${LEGACY_RELEASE_NAMESPACE}" >/dev/null 2>&1; then
  LEGACY_RELEASE_VALUES_YAML="$(mktemp -t legacy-release-values.XXXXXX.yaml)"
  helm get values "${LEGACY_RELEASE_NAME}" -n "${LEGACY_RELEASE_NAMESPACE}" -o yaml > "${LEGACY_RELEASE_VALUES_YAML}" 2>/dev/null || true
  echo "Captured values from legacy release '${LEGACY_RELEASE_NAME}' in namespace '${LEGACY_RELEASE_NAMESPACE}' for inheritance."
fi

# templateRepoUrl is deliberately NOT inherited from the legacy release. The
# legacy value may point to an in-cluster git service (e.g. gogs.<cloudDomain>)
# that no longer exists, which would break the new frontend at startup. Only
# honour an explicitly provided value (env var or user values file); otherwise
# fall through to the chart default (https://github.com/labring-actions/templates).
add_set_string templateConfig.userDomain             "$(inherit_legacy_value templateConfig.userDomain             "${userDomain:-}")"
add_set_string templateConfig.templateRepoUrl        "${templateRepoUrl:-}"
add_set_string templateConfig.templateRepoBranch     "$(inherit_legacy_value templateConfig.templateRepoBranch     "${templateRepoBranch:-}")"
add_set_string templateConfig.templateRepoPath       "$(inherit_legacy_value templateConfig.templateRepoPath       "${templateRepoPath:-}")"
add_set_string templateConfig.guideEnabled           "$(inherit_legacy_value templateConfig.guideEnabled           "${guideEnabled:-}")"
add_set_string templateConfig.billingUrl             "$(inherit_legacy_value templateConfig.billingUrl             "${billingUrl:-}")"
add_set_string templateConfig.enableReadmeFetch      "$(inherit_legacy_value templateConfig.templateRepoEnableReadmeFetch "${enableReadmeFetch:-}")"
add_set_string templateConfig.brandName              "$(inherit_legacy_value templateConfig.brandName              "${brandName:-}")"
add_set_string templateConfig.forcedLanguage         "$(inherit_legacy_value templateConfig.forcedLanguage         "${forcedLanguage:-}")"
add_set_string templateConfig.currencySymbol         "$(inherit_legacy_value templateConfig.currencySymbol         "${currencySymbol:-}")"

# ----------------------------------------------------------------------------
# Step 1: Uninstall any legacy release living in the legacy namespace.
# Helm cannot move a release across namespaces, so the only safe way to
# relocate is to uninstall first, then install into the new namespace.
# ----------------------------------------------------------------------------
uninstall_legacy_release() {
  local name="$1"
  local ns="$2"
  if ! command -v helm >/dev/null 2>&1; then
    echo "helm not found in PATH; skipping legacy release check." >&2
    return 0
  fi
  if helm status "${name}" -n "${ns}" >/dev/null 2>&1; then
    echo "Found legacy release '${name}' in namespace '${ns}'; uninstalling before redeploying as '${RELEASE_NAME}' in '${RELEASE_NAMESPACE}'..."
    helm uninstall "${name}" -n "${ns}" --wait --timeout 5m
    echo "Legacy release uninstalled."
  else
    echo "No legacy release '${name}' in namespace '${ns}'; nothing to uninstall."
  fi
}

cleanup_legacy_namespace() {
  local ns="$1"
  if [ "${CLEANUP_LEGACY_NS}" != "true" ]; then
    echo "CLEANUP_LEGACY_NS != true; leaving namespace '${ns}' in place."
    return 0
  fi
  if [ "${ns}" = "${RELEASE_NAMESPACE}" ]; then
    return 0
  fi
  if kubectl get namespace "${ns}" >/dev/null 2>&1; then
    echo "Deleting legacy namespace '${ns}'..."
    kubectl delete namespace "${ns}" --wait=false --ignore-not-found=true
  fi
}

# Uninstall the legacy release if it lives anywhere other than the target
# (different namespace OR different release name). Both situations require a
# real uninstall because Helm cannot rename a release nor move it across
# namespaces in place.
if [ "${LEGACY_RELEASE_NAMESPACE}" != "${RELEASE_NAMESPACE}" ] || [ "${LEGACY_RELEASE_NAME}" != "${RELEASE_NAME}" ]; then
  uninstall_legacy_release "${LEGACY_RELEASE_NAME}" "${LEGACY_RELEASE_NAMESPACE}"
  cleanup_legacy_namespace "${LEGACY_RELEASE_NAMESPACE}"
fi

# ----------------------------------------------------------------------------
# Step 2: Adopt any cluster-scoped resources that might have survived an
# earlier uninstall (or were created outside Helm) so the new release can
# take ownership cleanly.
# ----------------------------------------------------------------------------
adopt_namespaced_resource() {
  local namespace="$1"
  local kind="$2"
  local name="$3"
  if kubectl -n "${namespace}" get "${kind}" "${name}" >/dev/null 2>&1; then
    echo "Adopting ${kind} ${namespace}/${name}..."
    kubectl -n "${namespace}" label "${kind}" "${name}" app.kubernetes.io/managed-by=Helm --overwrite >/dev/null 2>&1 || true
    kubectl -n "${namespace}" annotate "${kind}" "${name}" meta.helm.sh/release-name="${RELEASE_NAME}" meta.helm.sh/release-namespace="${RELEASE_NAMESPACE}" --overwrite >/dev/null 2>&1 || true
  fi
}

adopt_cluster_resource() {
  local kind="$1"
  local name="$2"
  if kubectl get "${kind}" "${name}" >/dev/null 2>&1; then
    echo "Adopting ${kind} ${name}..."
    kubectl label "${kind}" "${name}" app.kubernetes.io/managed-by=Helm --overwrite >/dev/null 2>&1 || true
    kubectl annotate "${kind}" "${name}" meta.helm.sh/release-name="${RELEASE_NAME}" meta.helm.sh/release-namespace="${RELEASE_NAMESPACE}" --overwrite >/dev/null 2>&1 || true
  fi
}

echo "Checking and adopting existing resources..."
if kubectl get namespace "${RELEASE_NAMESPACE}" >/dev/null 2>&1; then
  kubectl label namespace "${RELEASE_NAMESPACE}" app.kubernetes.io/managed-by=Helm --overwrite >/dev/null 2>&1 || true
  kubectl annotate namespace "${RELEASE_NAMESPACE}" meta.helm.sh/release-name="${RELEASE_NAME}" meta.helm.sh/release-namespace="${RELEASE_NAMESPACE}" --overwrite >/dev/null 2>&1 || true

  adopt_namespaced_resource "${RELEASE_NAMESPACE}" configmap template-config
  adopt_namespaced_resource "${RELEASE_NAMESPACE}" service template
  adopt_namespaced_resource "${RELEASE_NAMESPACE}" deployment template
  adopt_namespaced_resource "${RELEASE_NAMESPACE}" ingress template
  adopt_namespaced_resource "${RELEASE_NAMESPACE}" cronjob template-static
fi

adopt_namespaced_resource app-system apps.app.sealos.io template
adopt_cluster_resource clusterrole template-static-role
adopt_cluster_resource clusterrolebinding template-static-role-binding

# ----------------------------------------------------------------------------
# Step 3: Resolve user-supplied values files.
#
# The platform convention is /root/.sealos/cloud/values/apps/<app>/<app>-values.yaml.
# For the template frontend the app directory is "template" (not the release
# name), so SERVICE_NAME is "template". A legacy location under
# /root/.sealos/cloud/values/core/template-frontend-values.yaml is also
# honoured for backwards compatibility.
# ----------------------------------------------------------------------------
SERVICE_NAME="template"
USER_VALUES_DIR="/root/.sealos/cloud/values/apps/${SERVICE_NAME}"
LEGACY_VALUES_PATH="/root/.sealos/cloud/values/core/${SERVICE_NAME}-values.yaml"
DEFAULT_VALUES_PATH="./charts/template-frontend/template-frontend-values.yaml"
DEFAULT_USER_VALUES_PATH="${USER_VALUES_DIR}/${SERVICE_NAME}-values.yaml"

copy_default_values() {
  if [ -f "${LEGACY_VALUES_PATH}" ]; then
    echo "WARN: copying legacy values from ${LEGACY_VALUES_PATH} to ${DEFAULT_USER_VALUES_PATH}." >&2
    cp "${LEGACY_VALUES_PATH}" "${DEFAULT_USER_VALUES_PATH}"
  else
    echo "WARN: copying chart defaults to ${DEFAULT_USER_VALUES_PATH}." >&2
    cp "${DEFAULT_VALUES_PATH}" "${DEFAULT_USER_VALUES_PATH}"
  fi
}

if [ ! -d "${USER_VALUES_DIR}" ]; then
  echo "WARN: ${USER_VALUES_DIR} does not exist; creating it with the chart defaults." >&2
  mkdir -p "${USER_VALUES_DIR}"
  copy_default_values
elif ! find "${USER_VALUES_DIR}" -maxdepth 1 -type f -name '*-values.yaml' -print -quit | grep -q .; then
  echo "WARN: ${USER_VALUES_DIR} has no *-values.yaml file; writing defaults." >&2
  copy_default_values
elif [ -f "${LEGACY_VALUES_PATH}" ] && [ -f "${DEFAULT_USER_VALUES_PATH}" ] && cmp -s "${DEFAULT_USER_VALUES_PATH}" "${DEFAULT_VALUES_PATH}"; then
  echo "WARN: migrating legacy values from ${LEGACY_VALUES_PATH}..." >&2
  cp "${LEGACY_VALUES_PATH}" "${DEFAULT_USER_VALUES_PATH}"
fi

# ----------------------------------------------------------------------------
# Step 4: Translate legacy values fields to the current chart schema.
#
# Older charts used fields like templateConfig.templateRepoEnableReadmeFetch,
# templateConfig.templateRepoAutoInject, templateConfig.templateRepoProvider,
# templateConfig.templateRepoGitSslNoVerify, templateConfig.showAuthor,
# templateConfig.accountUrl, templateConfig.templateCategories and
# templateConfig.tlsRejectUnauthorized. The current chart no longer consumes
# these, and the boolean-typed fields it does consume (guideEnabled,
# enableReadmeFetch) must be YAML booleans rather than quoted strings.
#
# We do this by reading the user's values files, extracting the fields the
# current chart still recognises, and re-emitting them as an additional
# values file passed AFTER the user files so it takes precedence.
# ----------------------------------------------------------------------------
MIGRATED_VALUES_PATH="${USER_VALUES_DIR}/.migrated-values.yaml"

extract_yaml_field() {
  # Very small YAML scalar extractor: matches "  <key>: <value>" under a given
  # parent key. Only supports single-level nesting under templateConfig.
  local file="$1"
  local parent="$2"
  local key="$3"
  awk -v parent="${parent}" -v key="${key}" '
    $0 ~ "^" parent ":" { in_parent=1; next }
    in_parent && /^[^[:space:]]/ { in_parent=0 }
    in_parent {
      sub(/^[[:space:]]+/, "")
      if ($0 ~ "^" key ":") {
        sub("^" key ":[[:space:]]*", "")
        gsub(/^["'\'']|["'\'']$/, "")
        print
        exit
      }
    }
  ' "${file}" 2>/dev/null
}

migrate_values() {
  local src="$1"
  [ -f "${src}" ] || return 0

  local v
  {
    echo "# Auto-migrated from ${src} - do not edit"
    echo "templateConfig:"
  } > "${MIGRATED_VALUES_PATH}.tmp"

  # Pass-through fields the current chart still recognises
  for key in userDomain templateRepoUrl templateRepoBranch templateRepoPath billingUrl brandName forcedLanguage currencySymbol rybbitHost rybbitSiteId; do
    v=$(extract_yaml_field "${src}" "templateConfig" "${key}")
    if [ -n "${v}" ]; then
      printf '  %s: "%s"\n' "${key}" "${v}" >> "${MIGRATED_VALUES_PATH}.tmp"
    fi
  done

  # Boolean-coerced fields
  v=$(extract_yaml_field "${src}" "templateConfig" "guideEnabled")
  if [ -n "${v}" ]; then
    printf '  guideEnabled: %s\n' "${v}" >> "${MIGRATED_VALUES_PATH}.tmp"
  fi

  # Renamed: templateRepoEnableReadmeFetch -> enableReadmeFetch
  v=$(extract_yaml_field "${src}" "templateConfig" "enableReadmeFetch")
  if [ -z "${v}" ]; then
    v=$(extract_yaml_field "${src}" "templateConfig" "templateRepoEnableReadmeFetch")
  fi
  if [ -n "${v}" ]; then
    printf '  enableReadmeFetch: %s\n' "${v}" >> "${MIGRATED_VALUES_PATH}.tmp"
  fi

  if [ -s "${MIGRATED_VALUES_PATH}.tmp" ] && grep -q '^  ' "${MIGRATED_VALUES_PATH}.tmp"; then
    mv "${MIGRATED_VALUES_PATH}.tmp" "${MIGRATED_VALUES_PATH}"
    echo "Migrated legacy values from ${src} -> ${MIGRATED_VALUES_PATH}"
  else
    rm -f "${MIGRATED_VALUES_PATH}.tmp"
  fi
}

# Migrate every user values file in lexical order so the last one wins, just
# like Helm's own -f merging.
for f in $(find "${USER_VALUES_DIR}" -maxdepth 1 -type f -name '*-values.yaml' ! -name '.migrated-values.yaml' -print | sort); do
  migrate_values "${f}"
done

# ----------------------------------------------------------------------------
# Step 5: Build the helm command line and upgrade/install.
# ----------------------------------------------------------------------------
HELM_VALUE_ARGS=(-f "./charts/template-frontend/values.yaml")
if [ -f "${LEGACY_VALUES_PATH}" ]; then
  HELM_VALUE_ARGS+=(-f "${LEGACY_VALUES_PATH}")
fi
while IFS= read -r values_file; do
  HELM_VALUE_ARGS+=(-f "${values_file}")
done < <(find "${USER_VALUES_DIR}" -maxdepth 1 -type f -name '*-values.yaml' ! -name '.migrated-values.yaml' -print | sort)
# Migrated values last so translated fields take precedence over the originals.
if [ -f "${MIGRATED_VALUES_PATH}" ]; then
  HELM_VALUE_ARGS+=(-f "${MIGRATED_VALUES_PATH}")
fi

HELM_ARGS="${AUTO_CONFIG_HELM_OPTS} ${HELM_OPTIONS} ${HELM_OPTS}"

echo "Deploying Helm chart '${CHART_PATH}' as release '${RELEASE_NAME}' into namespace '${RELEASE_NAMESPACE}'..."
helm upgrade -i "${RELEASE_NAME}" -n "${RELEASE_NAMESPACE}" --create-namespace "${CHART_PATH}" \
  "${HELM_VALUE_ARGS[@]}" \
  ${HELM_ARGS}

if [ -n "${LEGACY_RELEASE_VALUES_YAML}" ] && [ -f "${LEGACY_RELEASE_VALUES_YAML}" ]; then
  rm -f "${LEGACY_RELEASE_VALUES_YAML}"
fi

echo "Done. '${RELEASE_NAME}' is now running in namespace '${RELEASE_NAMESPACE}'."
