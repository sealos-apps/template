"""Exercise the installer with fake Kubernetes/Helm commands; never contacts a cluster."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


INSTALLER = Path(__file__).resolve().parents[1] / "template-frontend-entrypoint.sh"


class LegacyCleanupTest(unittest.TestCase):
    def run_installer(self, **scenario):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            values = root / "values"
            chart = root / "charts/template-frontend"
            chart.mkdir(parents=True)
            (chart / "values.yaml").write_text("{}\n")
            (chart / "template-values.yaml").write_text("{}\n")
            script = root / "install.sh"
            script.write_text(INSTALLER.read_text().replace(
                'USER_VALUES_DIR="/root/.sealos/cloud/values/apps/${SERVICE_NAME}"',
                f'USER_VALUES_DIR="{values}"'))
            mock = root / "kubectl"
            mock.write_text("""#!/usr/bin/env python3
import json, os, sys
a = sys.argv[1:]
with open(os.environ['CALL_LOG'], 'a') as f:
    f.write(json.dumps([os.path.basename(sys.argv[0])] + a) + '\\n')
if os.path.basename(sys.argv[0]) == 'helm':
    sys.exit(int(os.environ.get('HELM_FAILURE', '0')))
if a[:3] == ['get', 'namespace', 'template-frontend']:
    sys.exit(int(os.environ.get('LEGACY_ABSENT', '0')))
if a[:2] == ['get', 'pvc,statefulset']:
    print(os.environ.get('PERSISTENT', ''))
if a[:2] == ['get', 'pods']:
    print(os.environ.get('PODS', 'template-test'))
if a[0] == 'exec':
    sys.exit(int(os.environ.get('CATALOG_FAILURE', '0')))
if '-o' in a and 'yaml' in a:
    print('apiVersion: v1\\nkind: List\\nitems: []')
""")
            mock.chmod(0o755)
            (root / "helm").symlink_to(mock)
            log = root / "calls.jsonl"
            env = {**os.environ, "PATH": f"{root}:{os.environ['PATH']}",
                   "CALL_LOG": str(log), "TOOLS_FILE": str(root / "missing"),
                   "SEALOS_CLOUD_DOMAIN": "example.test", "CERT_MODE": "https",
                   **scenario}
            result = subprocess.run(["bash", str(script)], cwd=root, env=env,
                                    capture_output=True, text=True)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            backups = list(values.glob("*.bak")) if values.exists() else []
            return result, calls, [(p.read_text(), p.stat().st_mode & 0o777) for p in backups]

    def assert_not_deleted(self, calls):
        self.assertFalse(any(c[1:3] == ["delete", "namespace"] for c in calls))

    def test_success_backs_up_then_checks_catalog_then_deletes(self):
        result, calls, backups = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)
        backup = next(i for i, c in enumerate(calls) if "deployment,service,ingress,cronjob,configmap,secret,serviceaccount,role,rolebinding" in c)
        install = next(i for i, c in enumerate(calls) if c[:2] == ["helm", "upgrade"])
        probe = next(i for i, c in enumerate(calls) if c[1] == "exec")
        delete = next(i for i, c in enumerate(calls) if c[1:3] == ["delete", "namespace"])
        self.assertLess(backup, install)
        self.assertLess(install, probe)
        self.assertLess(probe, delete)
        self.assertEqual(backups[0][1], 0o600)
        self.assertFalse(any(c[:2] == ["helm", "uninstall"] for c in calls))

    def test_failed_catalog_keeps_namespace(self):
        result, calls, _ = self.run_installer(CATALOG_FAILURE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(any(c[1] == "exec" for c in calls))
        self.assert_not_deleted(calls)

    def test_failed_install_keeps_namespace(self):
        result, calls, _ = self.run_installer(HELM_FAILURE="1")
        self.assertNotEqual(result.returncode, 0)
        self.assert_not_deleted(calls)

    def test_persistent_resources_prevent_install_and_cleanup(self):
        result, calls, _ = self.run_installer(PERSISTENT="persistentvolumeclaim/data")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(c[0] == "helm" for c in calls))
        self.assert_not_deleted(calls)

    def test_same_namespace_is_preserved(self):
        result, calls, backups = self.run_installer(RELEASE_NAMESPACE="template-frontend")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(backups, [])
        self.assert_not_deleted(calls)

    def test_absent_legacy_namespace_is_idempotent(self):
        result, calls, backups = self.run_installer(LEGACY_ABSENT="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(backups, [])
        self.assert_not_deleted(calls)

    def test_missing_replacement_pods_keeps_namespace(self):
        result, calls, _ = self.run_installer(PODS="")
        self.assertNotEqual(result.returncode, 0)
        self.assert_not_deleted(calls)


if __name__ == "__main__":
    unittest.main()
