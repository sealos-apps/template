import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendTemplateManifestSources,
  getTemplateManifestFiles
} from '@/services/backend/template-manifests';

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'template-manifests-'));
  temporaryDirectories.push(root);
  const templateDir = path.join(root, 'template', 'demo');
  fs.mkdirSync(path.join(templateDir, 'manifests', 'nested'), { recursive: true });
  const templateFile = path.join(templateDir, 'template.yaml');
  fs.writeFileSync(templateFile, 'template');
  fs.writeFileSync(path.join(templateDir, 'manifests', 'service.yaml'), 'kind: Service');
  fs.writeFileSync(path.join(templateDir, 'manifests', 'nested', 'config.yml'), 'kind: ConfigMap');
  return { root, templateDir, templateFile };
}

describe('template manifest sources', () => {
  it('collects nested YAML manifests and appends them in stable order', () => {
    const { root, templateDir, templateFile } = createFixture();
    expect(getTemplateManifestFiles(templateFile, root)).toEqual([
      path.join(templateDir, 'manifests', 'nested', 'config.yml'),
      path.join(templateDir, 'manifests', 'service.yaml')
    ]);
    expect(appendTemplateManifestSources('kind: Instance', templateFile, root)).toBe(
      'kind: Instance\n---\nkind: ConfigMap\n---\nkind: Service'
    );
  });

  it('ignores a manifest symlink that escapes the template directory', () => {
    const { root, templateDir, templateFile } = createFixture();
    const outside = path.join(root, 'outside.yaml');
    fs.writeFileSync(outside, 'kind: Secret');
    fs.symlinkSync(outside, path.join(templateDir, 'manifests', 'outside.yaml'));

    expect(getTemplateManifestFiles(templateFile, root)).not.toContain(
      path.join(templateDir, 'manifests', 'outside.yaml')
    );
  });
});
