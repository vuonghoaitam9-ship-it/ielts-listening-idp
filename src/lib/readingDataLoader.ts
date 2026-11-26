import { db } from '../db/database';
import type {
  ReadingManifestData,
  ReadingManifestEntry,
  ReadingTestData,
} from '../types/reading';

const managedBlobUrls = new Set<string>();

export function revokeReadingObjectUrls(): void {
  for (const url of managedBlobUrls) {
    URL.revokeObjectURL(url);
  }
  managedBlobUrls.clear();
}

export async function loadReadingManifest(): Promise<ReadingManifestData> {
  const res = await fetch('./data/reading-manifest.json');
  if (!res.ok) {
    throw new Error(`Không thể tải reading-manifest.json (HTTP ${res.status})`);
  }
  const manifest = (await res.json()) as ReadingManifestData;

  const overrides = await db.readingLocalOverrides.toArray();
  if (overrides.length === 0) return manifest;

  const overrideMap = new Map(overrides.map((o) => [o.testId, o]));
  const mergedTests: ReadingManifestEntry[] = manifest.tests.map((entry) => {
    const ov = overrideMap.get(entry.testId);
    if (!ov) return entry;

    const ovKeyCount =
      ov.testData?.keyCount ??
      (ov.testData?.passages
        ? ov.testData.passages.reduce(
            (acc, p) =>
              acc +
              p.groups.reduce(
                (ga, g) => ga + g.questions.filter((q) => q.acceptedAnswers.length > 0).length,
                0
              ),
            0
          )
        : entry.keyCount);

    const hasKey = ovKeyCount > 0 || entry.hasKey;
    const missingComponents: string[] = [];
    if (ov.sourceMode === 'scanned_pdf' && !ov.pdfBlob) missingComponents.push('PDF');
    if (ovKeyCount < 40) missingComponents.push(`Key (${ovKeyCount}/40)`);

    return {
      ...entry,
      title: ov.testData?.title || entry.title,
      keyCount: ovKeyCount,
      hasKey,
      status: ovKeyCount >= 40 ? 'ready' : 'partial',
      missingComponents,
      sourceName:
        ov.sourceMode === 'scanned_pdf'
          ? 'Tải lên cục bộ (PDF Scan)'
          : 'Tải lên cục bộ (IndexedDB)',
    };
  });

  const readyTests = mergedTests.filter((t) => t.status === 'ready').length;
  return {
    ...manifest,
    tests: mergedTests,
    readyTests,
    partialTests: mergedTests.length - readyTests,
  };
}

export async function loadReadingTestData(
  vol: number,
  test: number
): Promise<ReadingTestData | null> {
  const testId = `vol-${vol}-test-${test}`;
  const override = await db.readingLocalOverrides.get(testId);

  if (override) {
    if (override.sourceMode === 'scanned_pdf' && override.pdfBlob) {
      const pdfUrl = URL.createObjectURL(override.pdfBlob);
      managedBlobUrls.add(pdfUrl);
      const base = override.testData;
      return {
        vol,
        test,
        testId,
        title: base?.title ?? `Vol ${vol} - Test ${test} (PDF cục bộ)`,
        sourceName: 'Tải lên cục bộ (PDF Scan)',
        status: (base?.keyCount ?? 0) >= 40 ? 'ready' : 'partial',
        hasKey: (base?.keyCount ?? 0) > 0,
        keyCount: base?.keyCount ?? 0,
        missingNote: override.missingNote ?? base?.missingNote ?? null,
        passages: base?.passages ?? [],
        sourceMode: 'scanned_pdf',
        localPdfUrl: pdfUrl,
        isLocalOverride: true,
      };
    }

    if (override.testData) {
      return {
        ...override.testData,
        sourceMode: 'structured',
        isLocalOverride: true,
      };
    }
  }

  const url = `./data/vol-${vol}/test-${test}/reading.json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as ReadingTestData;
  return {
    ...data,
    sourceMode: data.sourceMode ?? 'structured',
  };
}
