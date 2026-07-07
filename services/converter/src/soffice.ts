import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * Converts a pptx to pdf with headless LibreOffice. Each invocation uses an
 * isolated user profile dir so concurrent/sequential runs never fight over
 * the profile lock.
 */
export async function pptxToPdf(pptx: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "converter-soffice-"));
  try {
    const inputPath = join(dir, "input.pptx");
    await writeFile(inputPath, pptx);
    await execFileAsync(
      "soffice",
      [
        `-env:UserInstallation=file://${dir}/profile`,
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        dir,
        inputPath,
      ],
      { timeout: 5 * 60 * 1000 }
    );
    return await readFile(join(dir, "input.pdf"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
