import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

/**
 * ffmpeg/ffprobe wrappers for asset ingestion (M6). ffmpeg does ALL raster
 * work here — video probe/transcode, poster frames, image resizing, and
 * SMask alpha recombination — so the service needs no native image npm
 * dependency. Every function is bytes-in/bytes-out over a temp dir, same
 * discipline as pdf.ts.
 */

export interface MediaProbe {
  /** Media duration in ms (0 for still images). */
  durationMs: number;
  width: number;
  height: number;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  codec: string | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: FfprobeStream[];
}

/** Even-dimension scale filter capping the longest edge (H.264 needs even). */
export function scaleFilter(maxEdgePx: number): string {
  // Downscale-only: min(1,maxEdge/longest) never upscales; -2 keeps even dims.
  return `scale=trunc(iw*min(1\\,${maxEdgePx}/max(iw\\,ih))/2)*2:trunc(ih*min(1\\,${maxEdgePx}/max(iw\\,ih))/2)*2`;
}

async function inTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "converter-media-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function probeMedia(bytes: Buffer, ext: string): Promise<MediaProbe> {
  return inTempDir(async (dir) => {
    const path = join(dir, `input.${ext}`);
    await writeFile(path, bytes);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ]);
    const probe = JSON.parse(stdout) as FfprobeOutput;
    const video = probe.streams?.find((s) => s.codec_type === "video") ?? null;
    const audio = probe.streams?.find((s) => s.codec_type === "audio") ?? null;
    const durationSeconds = Number(
      probe.format?.duration ?? video?.duration ?? 0
    );
    return {
      durationMs: Number.isFinite(durationSeconds)
        ? Math.round(durationSeconds * 1000)
        : 0,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      hasVideoStream: video !== null,
      hasAudioStream: audio !== null,
      codec: video?.codec_name ?? null,
    };
  });
}

/**
 * Transcode to a muted, capped-resolution, streamable H.264 MP4. `-an`
 * mechanically strips any audio track — narration is the only audio in a
 * course, by contract, so no source soundtrack can ever leak through.
 */
export async function transcodeVideo(
  bytes: Buffer,
  ext: string,
  maxEdgePx: number
): Promise<Buffer> {
  return inTempDir(async (dir) => {
    const input = join(dir, `input.${ext}`);
    const output = join(dir, "output.mp4");
    await writeFile(input, bytes);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      input,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-vf",
      scaleFilter(maxEdgePx),
      output,
    ]);
    return readFile(output);
  });
}

/** Poster frame as JPEG: 1s in, falling back to the first frame for sub-second clips. */
export async function extractPoster(
  bytes: Buffer,
  ext: string,
  maxEdgePx: number
): Promise<Buffer> {
  return inTempDir(async (dir) => {
    const input = join(dir, `input.${ext}`);
    const output = join(dir, "poster.jpg");
    await writeFile(input, bytes);
    const attempt = async (seekSeconds: number) =>
      execFileAsync("ffmpeg", [
        "-y",
        "-ss",
        String(seekSeconds),
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        scaleFilter(maxEdgePx),
        output,
      ]);
    try {
      await attempt(1);
      return await readFile(output);
    } catch {
      await attempt(0);
      return readFile(output);
    }
  });
}

/**
 * Re-encode an image with its longest edge capped. Output format follows
 * `outExt` ("jpg" | "png" — png preserves transparency). Animated inputs
 * collapse to their first frame (deterministic rendering downstream).
 */
export async function resizeImage(
  bytes: Buffer,
  ext: string,
  maxEdgePx: number,
  outExt: "jpg" | "png"
): Promise<Buffer> {
  return inTempDir(async (dir) => {
    const input = join(dir, `input.${ext}`);
    const output = join(dir, `output.${outExt}`);
    await writeFile(input, bytes);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      scaleFilter(maxEdgePx),
      output,
    ]);
    return readFile(output);
  });
}

/**
 * Recombine a PDF base image with its SMask (soft mask) into a transparent
 * PNG — pdfimages emits the pair as separate files. Best-effort: callers
 * fall back to the base image when the merge fails.
 */
export async function alphaMerge(
  imageBytes: Buffer,
  imageExt: string,
  maskBytes: Buffer,
  maskExt: string
): Promise<Buffer> {
  return inTempDir(async (dir) => {
    const image = join(dir, `image.${imageExt}`);
    const mask = join(dir, `mask.${maskExt}`);
    const output = join(dir, "merged.png");
    await writeFile(image, imageBytes);
    await writeFile(mask, maskBytes);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      image,
      "-i",
      mask,
      "-filter_complex",
      // The mask must match the base dimensions for alphamerge.
      "[1:v][0:v]scale2ref[mask][base];[base][mask]alphamerge",
      output,
    ]);
    return readFile(output);
  });
}

/** True when ffmpeg + ffprobe are on PATH (gates the real-binary tests). */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    await execFileAsync("ffprobe", ["-version"]);
    return true;
  } catch {
    return false;
  }
}
