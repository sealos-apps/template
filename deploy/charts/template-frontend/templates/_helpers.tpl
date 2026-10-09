{{/* Expand the name of the chart. */}}
{{- define "template.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Create a default fully qualified app name. */}}
{{- define "template.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "template.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "template.labels" -}}
helm.sh/chart: {{ include "template.chart" . }}
{{ include "template.selectorLabels" . }}
{{ include "template.recommendedLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "template.selectorLabels" -}}
app: {{ include "template.fullname" . }}
{{- end }}

{{- define "template.recommendedLabels" -}}
app.kubernetes.io/name: {{ include "template.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "template.scheme" -}}
{{- if eq (include "template.disableHttps" .) "true" -}}http{{- else -}}https{{- end -}}
{{- end }}

{{- define "template.cloudDomain" -}}
{{- default .Values.templateConfig.cloudDomain .Values.cloudDomain -}}
{{- end }}

{{- define "template.cloudPort" -}}
{{- default .Values.templateConfig.cloudPort .Values.cloudPort -}}
{{- end }}

{{- define "template.httpPort" -}}
{{- default .Values.templateConfig.httpPort .Values.httpPort -}}
{{- end }}

{{- define "template.disableHttps" -}}
{{- $rootDisableHttps := toString .Values.disableHttps -}}
{{- if ne $rootDisableHttps "" -}}
{{- $rootDisableHttps -}}
{{- else -}}
{{- toString .Values.templateConfig.disableHttps -}}
{{- end -}}
{{- end }}

{{- define "template.certSecretName" -}}
{{- default .Values.templateConfig.certSecretName .Values.certSecretName -}}
{{- end }}

{{- define "template.port" -}}
{{- $scheme := include "template.scheme" . -}}
{{- $port := toString (include "template.cloudPort" .) -}}
{{- if eq $scheme "http" -}}
{{- $port = toString (include "template.httpPort" .) -}}
{{- end -}}
{{- if or (and (eq $scheme "https") (or (eq $port "") (eq $port "443"))) (and (eq $scheme "http") (or (eq $port "") (eq $port "80"))) -}}
{{- "" -}}
{{- else -}}
{{- $port -}}
{{- end }}
{{- end }}

{{- define "template.portSuffix" -}}
{{- $port := include "template.port" . -}}
{{- if $port -}}:{{ $port }}{{- end -}}
{{- end }}

{{- define "template.portEnv" -}}
{{- $port := include "template.port" . -}}
{{- if $port -}}:{{ $port }}{{- end -}}
{{- end }}

{{- define "template.cloudOrigin" -}}
{{- include "template.scheme" . -}}://{{ include "template.cloudDomain" . }}{{ include "template.portSuffix" . }}
{{- end }}

{{- define "template.wildcardCloudOrigin" -}}
{{- include "template.scheme" . -}}://*.{{ include "template.cloudDomain" . }}{{ include "template.portSuffix" . }}
{{- end }}

{{- define "template.host" -}}
{{- default (printf "template.%s" (include "template.cloudDomain" .)) .Values.ingress.host -}}
{{- end }}

{{- define "template.appUrl" -}}
{{- include "template.scheme" . -}}://{{ include "template.host" . }}{{ include "template.portSuffix" . }}
{{- end }}
