import 'server-only';
import sharp from 'sharp';
import { revalidatePath } from 'next/cache';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink, rmdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadOutput, uploadThumbnail } from '@/lib/supabase/storage';
import { completeGeneration } from '@/lib/credits/operations';
import type { GenerationRow } from './handlers/types';

function inferExtension(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  return 'bin';
}

async function makeImageThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
}

async function makeVideoThumbnail(buffer: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'zyra-thumb-'));
  const inputPath = join(dir, 'input.mp4');
  const outputPath = join(dir, 'thumb.jpg');
  await writeFile(inputPath, buffer);

  try {
    return await new Promise((resolve, reject) => {
      const ffmpeg = spawn(
        ffmpegInstaller.path,
        [
          '-loglevel', 'error',
          '-i', inputPath,
          '-ss', '0',
          '-frames:v', '1',
          '-vf', 'scale=512:-1',
          '-q:v', '4',
          outputPath,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let errMsg = '';
      ffmpeg.stderr.on('data', (c) => (errMsg += c.toString()));
      ffmpeg.on('error', reject);
      ffmpeg.on('close', async (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg exit ${code}: ${errMsg.slice(0, 300)}`));
          return;
        }
        try {
          resolve(await readFile(outputPath));
        } catch (e) {
          reject(e);
        }
      });
    });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rmdir(dir).catch(() => {});
  }
}

// Audio siempre devuelve null (no hay thumbnail visual).
async function makeThumbnail(
  type: GenerationRow['type'],
  buffer: Buffer,
  _mimeType: string,
): Promise<Buffer | null> {
  if (type === 'image') return makeImageThumbnail(buffer);
  if (type === 'video') {
    try {
      return await makeVideoThumbnail(buffer);
    } catch (err) {
      // Si FFmpeg falla, seguimos sin thumbnail. La UI muestra placeholder.
      console.error('[finalize] video thumbnail falló', err);
      return null;
    }
  }
  return null;
}

export async function finalizeGeneration(params: {
  gen: GenerationRow;
  outputBuffer: Buffer;
  mimeType: string;
  processingMs: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { gen, outputBuffer, mimeType, processingMs, metadata } = params;
  const ext = inferExtension(mimeType);

  const outputPath = await uploadOutput(
    gen.workspace_id,
    gen.id,
    outputBuffer,
    mimeType,
    ext,
  );

  const thumbBuffer = await makeThumbnail(gen.type, outputBuffer, mimeType);
  const thumbPath = thumbBuffer
    ? await uploadThumbnail(gen.workspace_id, gen.id, thumbBuffer)
    : null;

  await completeGeneration({
    userId: gen.user_id,
    generationId: gen.id,
    cost: gen.credits_estimated,
    outputUrl: outputPath,
    thumbnailUrl: thumbPath,
    processingMs,
    fileSizeBytes: outputBuffer.byteLength,
    providerPayload: metadata ?? null,
  });

  revalidatePath('/app/library');
  revalidatePath('/app/create/video');
  revalidatePath('/app/create/audio');
}
