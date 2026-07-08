import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { OBJECT_KEY_PATTERN } from "@counseliq/course-schema";
import { ffmpegAvailable } from "../src/ffmpeg";
import type { AssetStore } from "../src/media";
import {
  extractPdfImages,
  pairSmasks,
  parsePdfImagesList,
  passesImageFilter,
  pdfimagesAvailable,
  routeRepeats,
  type PdfImageOptions,
} from "../src/pdf-images";

const OPTIONS: PdfImageOptions = {
  minEdgePx: 200,
  maxAspect: 5,
  logoPageThreshold: 3,
  thumbEdgePx: 480,
};

/** Verbatim shape of poppler's `pdfimages -list` output. */
const LIST_FIXTURE = `page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio
--------------------------------------------------------------------------------------------
   1     0 image    1860   649  rgb     3   8  jpeg   no        13  0   150   150 30.4K 0.9%
   1     1 smask    1860   649  gray    1   8  image  no        13  0   150   150  1.2K 0.1%
   2     2 image     120    40  rgb     3   8  image  no        21  0    72    72  1.1K 2.0%
   2     3 image    2000   180  rgb     3   8  jpeg   no        22  0   150   150 10.0K 0.5%
   3     4 image     800   800  rgb     3   8  image  no  [inline]        150   150 42.0K 1.1%
   3     5 stencil    16    16  -       1   1  image  no        30  0   150   150   12B 0.5%
`;

describe("parsePdfImagesList", () => {
  test("parses image/smask/stencil rows, tolerating [inline] object ids", () => {
    const rows = parsePdfImagesList(LIST_FIXTURE);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({
      page: 1,
      num: 0,
      type: "image",
      width: 1860,
      height: 649,
      enc: "jpeg",
    });
    expect(rows[1].type).toBe("smask");
    expect(rows[4]).toMatchObject({ page: 3, num: 4, width: 800, height: 800 });
    expect(rows[5].type).toBe("stencil");
  });

  test("ignores header/divider/blank lines", () => {
    expect(parsePdfImagesList("")).toEqual([]);
    expect(parsePdfImagesList("page num type\n-----\n")).toEqual([]);
  });
});

describe("pairSmasks", () => {
  test("pairs an smask with the immediately preceding image on the same page", () => {
    const rows = parsePdfImagesList(LIST_FIXTURE);
    const pairs = pairSmasks(rows);
    expect(pairs).toHaveLength(4); // stencil + standalone smask rows drop out
    expect(pairs[0].image.num).toBe(0);
    expect(pairs[0].smask?.num).toBe(1);
    expect(pairs[1].smask).toBeNull();
    expect(pairs[2].smask).toBeNull();
  });

  test("smask on a different page does not pair", () => {
    const rows = parsePdfImagesList(LIST_FIXTURE).map((row, i) =>
      i === 1 ? { ...row, page: 9 } : row
    );
    const pairs = pairSmasks(rows);
    expect(pairs[0].smask).toBeNull();
  });
});

describe("passesImageFilter", () => {
  test("dimension floor and aspect cap", () => {
    expect(passesImageFilter({ width: 640, height: 360 }, OPTIONS)).toBe(true);
    expect(passesImageFilter({ width: 120, height: 40 }, OPTIONS)).toBe(false); // floor
    expect(passesImageFilter({ width: 199, height: 800 }, OPTIONS)).toBe(false); // floor
    expect(passesImageFilter({ width: 2000, height: 380 }, OPTIONS)).toBe(false); // sliver
    expect(passesImageFilter({ width: 1100, height: 210 }, OPTIONS)).toBe(false); // sliver
    expect(passesImageFilter({ width: 999, height: 200 }, OPTIONS)).toBe(true);
  });
});

describe("routeRepeats", () => {
  test("hash on >= threshold distinct pages becomes one logo candidate", () => {
    const occurrences = [
      { hash: "logo", page: 1, item: "logo-bytes" },
      { hash: "logo", page: 2, item: "logo-bytes" },
      { hash: "logo", page: 3, item: "logo-bytes" },
      { hash: "logo", page: 3, item: "logo-bytes" }, // same page twice
      { hash: "photo", page: 2, item: "photo-bytes" },
      { hash: "chart", page: 2, item: "chart-bytes" },
      { hash: "chart", page: 5, item: "chart-bytes" },
    ];
    const { catalogue, logos } = routeRepeats(occurrences, 3);
    expect(logos).toEqual(["logo-bytes"]);
    expect(catalogue).toEqual(
      expect.arrayContaining([
        { representative: "photo-bytes", pageNs: [2] },
        { representative: "chart-bytes", pageNs: [2, 5] },
      ])
    );
    expect(catalogue).toHaveLength(2);
  });

  test("threshold respects DISTINCT pages, not occurrence count", () => {
    const occurrences = [
      { hash: "a", page: 1, item: "a" },
      { hash: "a", page: 1, item: "a" },
      { hash: "a", page: 1, item: "a" },
    ];
    const { catalogue, logos } = routeRepeats(occurrences, 3);
    expect(logos).toEqual([]);
    expect(catalogue).toEqual([{ representative: "a", pageNs: [1] }]);
  });
});

const popplerAndFfmpeg = (await pdfimagesAvailable()) && (await ffmpegAvailable());

describe.skipIf(!popplerAndFfmpeg)("extractPdfImages over fixture pdfs", () => {
  function memoryStore(): AssetStore & { uploads: Map<string, Buffer> } {
    const uploads = new Map<string, Buffer>();
    return {
      uploads,
      async download() {
        throw new Error("not used");
      },
      async uploadIfAbsent(key, bytes) {
        if (!uploads.has(key)) uploads.set(key, Buffer.from(bytes));
      },
    };
  }

  test("doc-a yields a filtered, deduped set with thumbnails", { timeout: 120_000 }, async () => {
    const pdf = await readFile(
      join(__dirname, "../../../packages/course-schema/fixtures/ingestion/doc-a.pdf")
    );
    const store = memoryStore();
    const { images, logoCandidates } = await extractPdfImages(pdf, store, OPTIONS);

    // Extraction is content-dependent; assert the invariants, not counts.
    for (const image of images) {
      expect(image.key).toMatch(OBJECT_KEY_PATTERN);
      expect(image.thumbKey).toMatch(OBJECT_KEY_PATTERN);
      expect(Math.min(image.width, image.height)).toBeGreaterThanOrEqual(
        OPTIONS.minEdgePx
      );
      expect(
        Math.max(image.width, image.height) / Math.min(image.width, image.height)
      ).toBeLessThanOrEqual(OPTIONS.maxAspect);
      expect(image.pageNs.length).toBeGreaterThan(0);
      expect(store.uploads.has(image.key)).toBe(true);
      expect(store.uploads.has(image.thumbKey)).toBe(true);
    }
    for (const key of logoCandidates) {
      expect(key).toMatch(OBJECT_KEY_PATTERN);
      expect(store.uploads.has(key)).toBe(true);
    }
    // A ~42-page university brand deck must yield SOME usable imagery.
    expect(images.length + logoCandidates.length).toBeGreaterThan(0);

    // Idempotent: a second run reproduces the same manifest.
    const again = await extractPdfImages(pdf, store, OPTIONS);
    expect(again.images).toEqual(images);
    expect(again.logoCandidates).toEqual(logoCandidates);
  });
});
