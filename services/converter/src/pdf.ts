import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

const execFileAsync = promisify(execFile);

export interface RenderedPage {
  n: number;
  png: Buffer;
  thumb: Buffer;
}

/** Renders each pdf page to a PNG (150dpi) plus a small thumbnail via pdftoppm. */
export async function renderPdfPages(pdf: Buffer): Promise<RenderedPage[]> {
  const dir = await mkdtemp(join(tmpdir(), "converter-render-"));
  try {
    const pdfPath = join(dir, "input.pdf");
    await writeFile(pdfPath, pdf);

    await execFileAsync("pdftoppm", ["-png", "-r", "150", pdfPath, join(dir, "page")]);
    await execFileAsync("pdftoppm", ["-png", "-scale-to", "320", pdfPath, join(dir, "thumb")]);

    const files = await readdir(dir);
    const pageFiles = files
      .filter((f) => f.startsWith("page-") && f.endsWith(".png"))
      .sort();

    const pages: RenderedPage[] = [];
    for (const pageFile of pageFiles) {
      const suffix = pageFile.slice("page".length); // e.g. "-01.png"
      const n = Number(suffix.replace(/\D/g, ""));
      const thumbFile = `thumb${suffix}`;
      pages.push({
        n,
        png: await readFile(join(dir, pageFile)),
        thumb: await readFile(join(dir, thumbFile)),
      });
    }
    pages.sort((a, b) => a.n - b.n);
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Per-page text for pdf-native documents. */
export async function extractPdfText(pdf: Buffer): Promise<string[]> {
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const { text } = await extractText(doc, { mergePages: false });
  return text.map((t) => t.trim());
}
