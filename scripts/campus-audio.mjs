#!/usr/bin/env node

/**
 * Give a talking-head clip a restrained indoor or outdoor location treatment.
 * The video stream is copied unchanged; only the primary audio stream is replaced.
 *
 * Use a licensed, non-speech ambience recording when possible. The generated
 * noise beds are a self-contained fallback, not a replacement for real ambience.
 * The dialogue treatment emulates a nearby field microphone; it cannot create
 * the natural pacing or performance variation absent from a generated voice.
 */

import { spawn } from "node:child_process";
import { access, rename, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";

const SCENES = new Set(["indoor", "outdoor"]);

function usage() {
  return `Usage:
  npm run audio:campus -- --scene <indoor|outdoor> --input <clip> --output <clip> [options]

Required:
  --scene <indoor|outdoor>  Acoustic treatment to apply.
  --input <path>            Source video with a primary audio stream.
  --output <path>           New video path.

Optional:
  --ambience <path>         Licensed, non-speech ambience audio to loop beneath dialogue.
  --ambience-gain-db <db>   Extra ambience trim from -24 to +12 dB after low-level scene levelling. Defaults to 0.
  --video-finish <mode>     Video finish: copy (default) or camera.
  --force                   Replace an existing output file.
  --help                    Show this help text.

Examples:
  npm run audio:campus -- --scene outdoor --input avatar.mp4 --output avatar-outdoor.mp4
  npm run audio:campus -- --scene outdoor --input avatar.mp4 --output avatar-finished.mp4 --ambience courtyard.wav --video-finish camera
  npm run audio:campus -- --scene indoor --input avatar.mov --output avatar-indoor.mov --ambience room-tone.wav

Use ambience you have permission to use, and avoid recordings with intelligible bystander speech.
The selected output container must support the source video codec when using --video-finish copy.`;
}

function fail(message) {
  throw new Error(message);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const options = { force: false };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help") return { help: true };
    if (flag === "--force") {
      options.force = true;
      continue;
    }
    if (flag === "--scene") {
      options.scene = readValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--input") {
      options.input = readValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--output") {
      options.output = readValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--ambience") {
      options.ambience = readValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--ambience-gain-db") {
      options.ambienceGainDb = readValue(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === "--video-finish") {
      options.videoFinish = readValue(argv, index, flag);
      index += 1;
      continue;
    }
    fail(`Unknown option: ${flag}`);
  }

  if (!options.scene || !options.input || !options.output) {
    fail("--scene, --input, and --output are required");
  }
  if (!SCENES.has(options.scene)) {
    fail(`--scene must be one of: ${[...SCENES].join(", ")}`);
  }
  options.videoFinish ??= "copy";
  if (options.videoFinish !== "copy" && options.videoFinish !== "camera") {
    fail("--video-finish must be one of: copy, camera");
  }
  if (options.ambienceGainDb !== undefined) {
    if (!options.ambience) {
      fail("--ambience-gain-db requires --ambience");
    }
    options.ambienceGainDb = Number(options.ambienceGainDb);
    if (
      !Number.isFinite(options.ambienceGainDb) ||
      options.ambienceGainDb < -24 ||
      options.ambienceGainDb > 12
    ) {
      fail("--ambience-gain-db must be a number from -24 to +12");
    }
  }

  return options;
}

async function ensureReadable(path, label) {
  try {
    await access(path, constants.R_OK);
  } catch {
    fail(`${label} is not readable: ${path}`);
  }
}

async function ensureWritable(path, label) {
  try {
    await access(path, constants.W_OK);
  } catch {
    fail(`${label} is not writable: ${path}`);
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";

    if (capture) {
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
    }
    child.on("error", (error) => {
      reject(new Error(`Could not run ${command}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${command} failed with exit code ${code}${stderr ? `:\n${stderr.trim()}` : ""}`
          )
        );
      }
    });
  });
}

async function probeMedia(path, label) {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
    { capture: true }
  );
  let metadata;
  try {
    metadata = JSON.parse(stdout);
  } catch {
    fail(`Could not read ${label} metadata: ${path}`);
  }
  return metadata;
}

function audioStream(metadata) {
  return metadata.streams?.find((stream) => stream.codec_type === "audio");
}

function videoStream(metadata) {
  return metadata.streams?.find((stream) => stream.codec_type === "video");
}

function mediaDuration(metadata) {
  const duration = Number(metadata.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    fail("The input must have a finite duration");
  }
  return duration;
}

function filterGraph({ scene, duration, ambience, ambienceGainDb }) {
  const dialogue =
    scene === "indoor"
      ? [
          "[0:a:0]aresample=48000,highpass=f=90,lowpass=f=12000,equalizer=f=280:t=o:w=1.2:g=-1.5,equalizer=f=5400:t=o:w=1.5:g=-2.5,asplit=2[dry][reflections]",
          "[reflections]aecho=0.8:0.32:32|84|146:0.18|0.11|0.06[room]",
          "[dry][room]amix=inputs=2:duration=first:normalize=0[dialogue]",
        ].join(";")
      : [
          "[0:a:0]aresample=48000,highpass=f=105,lowpass=f=12000,equalizer=f=280:t=o:w=1.2:g=-1.5,equalizer=f=5400:t=o:w=1.5:g=-2.5,asplit=2[dry][reflections]",
          "[reflections]aecho=0.8:0.28:18|47:0.055|0.025[hardscape]",
          "[dry][hardscape]amix=inputs=2:duration=first:normalize=0[dialogue]",
        ].join(";");

  const bed = ambience
    ? `[1:a:0]aresample=48000,highpass=f=100,lowpass=f=${
        scene === "indoor" ? "6500" : "9000"
      },acompressor=threshold=0.04:ratio=12:attack=10:release=800:makeup=1,loudnorm=I=${
        scene === "indoor" ? "-48" : "-44"
      }:LRA=11:TP=-4,aresample=48000,volume=${ambienceGainDb}dB[bed]`
    : `anoisesrc=color=pink:amplitude=${
        scene === "indoor" ? "0.0025" : "0.005"
      }:sample_rate=48000:duration=${duration.toFixed(3)},highpass=f=100,lowpass=f=${
        scene === "indoor" ? "6500" : "9000"
      }[bed]`;

  return [
    dialogue,
    bed,
    "[bed][dialogue]sidechaincompress=threshold=0.12:ratio=3:attack=40:release=650:makeup=1:mix=0.7[ducked-bed]",
    "[dialogue][ducked-bed]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.891:attack=5:release=50,loudnorm=I=-16:LRA=11:TP=-1.5,aresample=48000[out-audio]",
  ].join(";");
}

function cameraVideoFilter(scene) {
  const color =
    scene === "outdoor"
      ? "eq=contrast=0.97:saturation=0.91:brightness=-0.006"
      : "eq=contrast=0.98:saturation=0.94:brightness=-0.003";

  // Intentionally small changes: digital over-sharpness and perfect colour are
  // more distracting than a modest amount of real-camera texture.
  return [
    color,
    "unsharp=lx=5:ly=5:la=-0.28",
    "noise=c0s=2:c0f=t+u:c1s=1:c1f=t+u:c2s=1:c2f=t+u",
    "vignette=PI/24",
    "format=yuv420p",
  ].join(",");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const input = resolve(options.input);
  const output = resolve(options.output);
  const ambience = options.ambience ? resolve(options.ambience) : null;
  if (input === output) fail("--output must be different from --input");

  await ensureReadable(input, "Input video");
  if (ambience) await ensureReadable(ambience, "Ambience audio");
  await ensureWritable(dirname(output), "Output directory");
  if ((await pathExists(output)) && !options.force) {
    fail(`Output already exists: ${output}. Re-run with --force to replace it.`);
  }

  const inputMetadata = await probeMedia(input, "input video");
  if (!videoStream(inputMetadata)) fail("The input does not contain a video stream");
  if (!audioStream(inputMetadata)) fail("The input does not contain an audio stream");
  const duration = mediaDuration(inputMetadata);

  if (ambience) {
    const ambienceMetadata = await probeMedia(ambience, "ambience audio");
    if (!audioStream(ambienceMetadata)) fail("The ambience file does not contain an audio stream");
  }

  const ambienceGainDb = options.ambienceGainDb ?? 0;
  const outputPath = parse(output);
  const temporaryOutput = join(
    dirname(output),
    `.${basename(outputPath.name)}.campus-audio-${process.pid}-${Date.now()}${outputPath.ext}`
  );
  const ffmpegArgs = ["-hide_banner", "-y", "-i", input];
  if (ambience) ffmpegArgs.push("-stream_loop", "-1", "-i", ambience);
  ffmpegArgs.push(
    "-filter_complex",
    filterGraph({ scene: options.scene, duration, ambience, ambienceGainDb }),
    "-map",
    "0:v:0",
    "-map",
    "[out-audio]",
    "-map_metadata",
    "0",
  );
  if (options.videoFinish === "camera") {
    ffmpegArgs.push("-vf", cameraVideoFilter(options.scene));
    ffmpegArgs.push("-c:v", "libx264", "-preset", "medium", "-crf", "17");
  } else if (options.videoFinish === "copy") {
    ffmpegArgs.push("-c:v", "copy");
  }
  ffmpegArgs.push(
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-shortest",
    temporaryOutput
  );

  console.log(`Applying ${options.scene} treatment to ${input}`);
  if (ambience) {
    console.log(`Looping ambience at ${ambienceGainDb} dB: ${ambience}`);
  } else {
    console.log("Using the built-in synthetic ambience fallback.");
  }
  if (options.videoFinish === "camera") {
    console.log("Applying the camera video finish (softening, sensor grain, and lens falloff).");
  }

  try {
    await run("ffmpeg", ffmpegArgs);
    await rename(temporaryOutput, output);
  } catch (error) {
    await rm(temporaryOutput, { force: true });
    throw error;
  }

  console.log(`Created ${output}`);
}

main().catch((error) => {
  console.error(`campus-audio: ${error.message}`);
  console.error(`\n${usage()}`);
  process.exitCode = 1;
});
