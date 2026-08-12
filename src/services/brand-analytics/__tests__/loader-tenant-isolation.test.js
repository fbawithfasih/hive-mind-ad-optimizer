/**
 * Tenant isolation for the Brand Analytics CSV fallback.
 *
 * resolveDataDir() used to fall back to the shared data/brand-analytics root
 * when an org had no directory of its own. That root holds whatever CSVs happen
 * to be present in the deployment, so the fallback could serve one tenant
 * another tenant's numbers. These tests pin the isolation down.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

let root;      // stands in for <cwd>/data/brand-analytics
let cwdSpy;

jest.mock('../../../db/prisma.js', () => ({
  prisma: { brandAnalyticsReport: { findFirst: jest.fn().mockResolvedValue(null) } },
}));

// loader.js resolves BA_DATA_ROOT from process.cwd() at import time, so the
// temp root has to be in place before the module is first required.
beforeAll(async () => {
  const base = await mkdtemp(join(tmpdir(), 'ba-iso-'));
  root = join(base, 'data', 'brand-analytics');
  await mkdir(root, { recursive: true });
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(base);
});

afterAll(async () => {
  cwdSpy.mockRestore();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

/** Write the two CSVs the loader treats as the required minimum. */
async function seedRequiredCsvs(dir) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'US_Search_Catalog_Performance.csv'), 'ASIN\nB000TEST01\n');
  await writeFile(join(dir, 'Top_Search_Terms.csv'), 'Search Term\nwidget\n');
}

describe('resolveDataDir', () => {
  it('returns the org directory when the org has one', async () => {
    const { resolveDataDir } = await import('../loader.js');
    const orgDir = join(root, 'org-with-data');
    await mkdir(orgDir, { recursive: true });

    expect(await resolveDataDir('org-with-data')).toBe(orgDir);
  });

  it('returns null — not the shared root — when the org has no directory', async () => {
    const { resolveDataDir } = await import('../loader.js');

    expect(await resolveDataDir('org-with-nothing')).toBeNull();
  });

  it('does not leak the shared root even when it holds usable CSVs', async () => {
    const { resolveDataDir } = await import('../loader.js');
    // Another tenant's reports sitting at the shared root.
    await seedRequiredCsvs(root);

    const resolved = await resolveDataDir('org-with-nothing');

    expect(resolved).toBeNull();
    expect(resolved).not.toBe(root);
  });
});

describe('BA_DATA_DIR override', () => {
  afterEach(() => { delete process.env.BA_DATA_DIR; });

  it('reads uploads from an absolute BA_DATA_DIR (a mounted volume in prod)', async () => {
    const { resolveDataDir } = await import('../loader.js');
    const volume = await mkdtemp(join(tmpdir(), 'ba-vol-'));
    const orgDir = join(volume, 'org-on-volume');
    await mkdir(orgDir, { recursive: true });
    process.env.BA_DATA_DIR = volume;

    expect(await resolveDataDir('org-on-volume')).toBe(orgDir);

    await rm(volume, { recursive: true, force: true });
  });

  it('still isolates per org when BA_DATA_DIR is set', async () => {
    const { resolveDataDir } = await import('../loader.js');
    const volume = await mkdtemp(join(tmpdir(), 'ba-vol-'));
    await seedRequiredCsvs(volume); // data sitting at the volume root
    process.env.BA_DATA_DIR = volume;

    expect(await resolveDataDir('org-with-no-dir-on-volume')).toBeNull();

    await rm(volume, { recursive: true, force: true });
  });
});

describe('loadAnalytics', () => {
  it('404s for an org with no data of its own, rather than serving the shared root', async () => {
    const { loadAnalytics, clearCache } = await import('../loader.js');
    await seedRequiredCsvs(root); // populated shared root — must still be ignored
    clearCache('org-with-nothing');

    await expect(loadAnalytics('org-with-nothing', 'Acme')).rejects.toMatchObject({
      status: 404,
    });
  });
});
