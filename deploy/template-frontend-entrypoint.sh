#!/bin/bash
set -e

# ============================================================================
# template entrypoint
#
# Deploys the template frontend Helm chart into the cluster.
#
# Behaviour:
#   - Reads platform configuration (cloudDomain, cloudPort, httpPort,
#     disableHttps, certSecretName, CERT_MODE) from the cluster's
#     sealos-config / cert-config ConfigMaps and injects them into Helm.
#   - Honours user-supplied values at
#     /root/.sealos/cloud/values/apps/template/*-values.yaml.
#   - Adopts any pre-existing resources so helm upgrade -i can take
#     ownership cleanly.
# ============================================================================


# ============================================================================
# SECTION 1: Configuration variables
#
# Every environment variable the script recognises, with its default.
# ============================================================================

RELEASE_NAME=${RELEASE_NAME:-"template"}
RELEASE_NAMESPACE=${RELEASE_NAMESPACE:-"template-system"}
CHART_PATH=${CHART_PATH:-"./charts/template-frontend"}
HELM_OPTS=${HELM_OPTS:-""}
HELM_OPTIONS=${HELM_OPTIONS:-""}
TOOLS_FILE=${TOOLS_FILE:-"/root/.sealos/cloud/scripts/tools.sh"}

# Accumulates `--set-string key=value` fragments produced by SECTION 4;
# expanded into the final helm invocation in SECTION 7.
AUTO_CONFIG_HELM_OPTS=""

# User-supplied values layout on the platform host.
SERVICE_NAME="template"
USER_VALUES_DIR="/root/.sealos/cloud/values/apps/${SERVICE_NAME}"
DEFAULT_VALUES_PATH="./charts/template-frontend/template-values.yaml"
DEFAULT_USER_VALUES_PATH="${USER_VALUES_DIR}/${SERVICE_NAME}-values.yaml"


# ============================================================================
# SECTION 2: Load platform tools
#
# sealos ships helper functions (get_cm_value, global_http_external_url,
# read_cert_tls_reject_unauthorized) in tools.sh. Source it if present.
# ============================================================================

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


# ============================================================================
# SECTION 3: Helper functions
# ============================================================================

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

# Append "--set-string key=value" to AUTO_CONFIG_HELM_OPTS, but only when
# the value is non-empty.
add_set_string() {
  local key="$1"
  local value="$2"
  if [ -n "${value}" ]; then
    AUTO_CONFIG_HELM_OPTS="${AUTO_CONFIG_HELM_OPTS} --set-string ${key}=${value}"
  fi
}

# Adopt a namespaced resource into the release by setting the Helm
# ownership annotations on it.
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

# Adopt a cluster-scoped resource into the release.
adopt_cluster_resource() {
  local kind="$1"
  local name="$2"
  if kubectl get "${kind}" "${name}" >/dev/null 2>&1; then
    echo "Adopting ${kind} ${name}..."
    kubectl label "${kind}" "${name}" app.kubernetes.io/managed-by=Helm --overwrite >/dev/null 2>&1 || true
    kubectl annotate "${kind}" "${name}" meta.helm.sh/release-name="${RELEASE_NAME}" meta.helm.sh/release-namespace="${RELEASE_NAMESPACE}" --overwrite >/dev/null 2>&1 || true
  fi
}


# ============================================================================
# SECTION 4: Resolve platform configuration
#
# Pull cloudDomain / cloudPort / httpPort / disableHttps / certSecretName
# from the platform's sealos-config ConfigMap (or env overrides) and feed
# them into Helm. Also derive platform.tlsRejectUnauthorized from CERT_MODE.
# ============================================================================

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
AUTO_CONFIG_HELM_OPTS="${AUTO_CONFIG_HELM_OPTS} --set-string platform.tlsRejectUnauthorized=${TLS_REJECT_UNAUTHORIZED}"


# ============================================================================
# SECTION 5: Adopt any pre-existing resources
#
# Resources that already exist (from a previous install that was not Helm-
# managed, or that survived a partial uninstall) need Helm ownership
# annotations before helm upgrade -i will accept them.
# ============================================================================

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


# ============================================================================
# SECTION 6: Prepare user-supplied values
#
# Make sure the user values directory exists and contains at least one
# *-values.yaml file. If it does not, seed it with the chart's defaults so
# operators have a starting point to edit.
# ============================================================================

if [ ! -d "${USER_VALUES_DIR}" ]; then
  echo "WARN: ${USER_VALUES_DIR} does not exist; creating it with the chart defaults." >&2
  mkdir -p "${USER_VALUES_DIR}"
  cp "${DEFAULT_VALUES_PATH}" "${DEFAULT_USER_VALUES_PATH}"
elif ! find "${USER_VALUES_DIR}" -maxdepth 1 -type f -name '*-values.yaml' ! -name '.*' ! -name '*.bak' -print -quit | grep -q .; then
  echo "WARN: ${USER_VALUES_DIR} has no *-values.yaml file; writing defaults." >&2
  cp "${DEFAULT_VALUES_PATH}" "${DEFAULT_USER_VALUES_PATH}"
fi


# ============================================================================
# SECTION 7: Deploy
#
# Build the final helm command line and run upgrade -i. Values files are
# layered from lowest to highest precedence: chart defaults, then user
# values (in lexical order).
# ============================================================================

HELM_VALUE_ARGS=(-f "./charts/template-frontend/values.yaml")
while IFS= read -r values_file; do
  HELM_VALUE_ARGS+=(-f "${values_file}")
done < <(find "${USER_VALUES_DIR}" -maxdepth 1 -type f -name '*-values.yaml' ! -name '.*' ! -name '*.bak' -print | sort)

HELM_ARGS="${AUTO_CONFIG_HELM_OPTS} ${HELM_OPTIONS} ${HELM_OPTS}"

echo "Deploying Helm chart '${CHART_PATH}' as release '${RELEASE_NAME}' into namespace '${RELEASE_NAMESPACE}'..."
helm upgrade -i "${RELEASE_NAME}" -n "${RELEASE_NAMESPACE}" --create-namespace "${CHART_PATH}" \
  "${HELM_VALUE_ARGS[@]}" \
  ${HELM_ARGS}

echo "Done. '${RELEASE_NAME}' is now running in namespace '${RELEASE_NAMESPACE}'."
