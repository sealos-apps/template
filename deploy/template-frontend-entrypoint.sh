#!/bin/bash
set -e

RELEASE_NAME=${RELEASE_NAME:-"template-frontend"}
RELEASE_NAMESPACE=${RELEASE_NAMESPACE:-"template-frontend"}
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

add_set_string templateConfig.userDomain "${userDomain:-}"
add_set_string templateConfig.templateRepoUrl "${templateRepoUrl:-}"
add_set_string templateConfig.templateRepoPublicUrl "${templateRepoPublicUrl:-}"
add_set_string templateConfig.templateRepoBranch "${templateRepoBranch:-}"
add_set_string templateConfig.templateRepoPath "${templateRepoPath:-}"
add_set_string templateConfig.guideEnabled "${guideEnabled:-}"
add_set_string templateConfig.billingUrl "${billingUrl:-}"
add_set_string templateConfig.enableReadmeFetch "${enableReadmeFetch:-}"
add_set_string templateConfig.brandName "${brandName:-}"
add_set_string templateConfig.forcedLanguage "${forcedLanguage:-}"
add_set_string templateConfig.currencySymbol "${currencySymbol:-}"

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

  adopt_namespaced_resource "${RELEASE_NAMESPACE}" configmap template-frontend-config
  adopt_namespaced_resource "${RELEASE_NAMESPACE}" service template-frontend
  adopt_namespaced_resource "${RELEASE_NAMESPACE}" deployment template-frontend
  adopt_namespaced_resource "${RELEASE_NAMESPACE}" ingress template-frontend
  adopt_namespaced_resource "${RELEASE_NAMESPACE}" cronjob template-static
fi

adopt_namespaced_resource app-system apps.app.sealos.io template
adopt_cluster_resource clusterrole template-frontend-static-role
adopt_cluster_resource clusterrolebinding template-frontend-static-role-binding

SERVICE_NAME="template-frontend"
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
  echo "WARN: /root/.sealos/cloud/values/apps/${SERVICE_NAME} does not exist; creating it with the chart defaults." >&2
  mkdir -p "${USER_VALUES_DIR}"
  copy_default_values
elif ! find "${USER_VALUES_DIR}" -maxdepth 1 -type f -name '*-values.yaml' -print -quit | grep -q .; then
  echo "WARN: /root/.sealos/cloud/values/apps/${SERVICE_NAME} has no *-values.yaml file; writing defaults." >&2
  copy_default_values
elif [ -f "${LEGACY_VALUES_PATH}" ] && [ -f "${DEFAULT_USER_VALUES_PATH}" ] && cmp -s "${DEFAULT_USER_VALUES_PATH}" "${DEFAULT_VALUES_PATH}"; then
  # A previous run may have created the canonical default before this
  # compatibility path was added. Preserve the existing custom values.
  echo "WARN: migrating legacy values from ${LEGACY_VALUES_PATH}..." >&2
  cp "${LEGACY_VALUES_PATH}" "${DEFAULT_USER_VALUES_PATH}"
fi

HELM_VALUE_ARGS=(-f "./charts/template-frontend/values.yaml")
if [ -f "${LEGACY_VALUES_PATH}" ]; then
  HELM_VALUE_ARGS+=(-f "${LEGACY_VALUES_PATH}")
fi
while IFS= read -r values_file; do
  HELM_VALUE_ARGS+=(-f "${values_file}")
done < <(find "${USER_VALUES_DIR}" -maxdepth 1 -type f -name '*-values.yaml' -print | sort)

HELM_ARGS="${AUTO_CONFIG_HELM_OPTS} ${HELM_OPTIONS} ${HELM_OPTS}"

echo "Deploying Helm chart..."
helm upgrade -i "${RELEASE_NAME}" -n "${RELEASE_NAMESPACE}" --create-namespace "${CHART_PATH}" \
  "${HELM_VALUE_ARGS[@]}" \
  ${HELM_ARGS}
