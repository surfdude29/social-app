import {type ImagePickerAsset} from 'expo-image-picker'
import {compress, probe, type VideoMetadata} from '@bsky.app/video-compressor'

import {SUPPORTED_MIME_TYPES, type SupportedMimeTypes} from '#/lib/constants'
import {logger} from '#/logger'
import {
  COMPRESSION_MAX_DIMENSION,
  COMPRESSION_TARGET_BITRATE,
} from './constants'
import {type CompressedVideo, type ProbedMetadata} from './types'

const MIN_SIZE_FOR_COMPRESSION_BYTES = 25 * 1024 * 1024 // 25mb

export async function compressVideo(
  file: ImagePickerAsset,
  opts?: {
    signal?: AbortSignal
    onProgress?: (progress: number) => void
    onProbe?: (metadata: ProbedMetadata) => void
  },
): Promise<CompressedVideo> {
  const {onProgress, signal, onProbe} = opts || {}

  if (file.mimeType === 'image/gif') {
    // let's hope they're small enough that they don't need compression!
    // this compression library doesn't support gifs
    // worst case - server rejects them. I think that's fine -sfn
    return {
      uri: file.uri,
      size: file.fileSize ?? -1,
      mimeType: 'image/gif',
      passthroughReason: 'gif',
    }
  }

  /*
   * Feeds both telemetry and the skip decision below. Failures must not block
   * the upload - an undefined result falls back to the size-only rule.
   */
  let metadata: ProbedMetadata | undefined
  try {
    metadata = toProbedMetadata(await probe(file.uri))
    onProbe?.(metadata)
  } catch (e) {
    logger.debug('video probe failed', {safeMessage: e})
  }

  // Pre-check the threshold ourselves so we can label the skip in telemetry.
  // rnc would do the same skip internally via minimumFileSizeForCompress, but
  // that path is invisible to us.
  //
  // HDR sources are exempt from the threshold no matter how small they are.
  // Compressing is what tone maps them down to BT.709 (the compressor pins its
  // compositor to 709), so passing the original PQ/HLG bytes through unchanged
  // leaves the video looking washed out for anyone whose player treats it as
  // SDR. The compressor's own passthrough decision only looks at mimeType and
  // byte size, so this is the only place the probe's isHDR can be acted on.
  const isAcceptableFormat = SUPPORTED_MIME_TYPES.includes(
    file.mimeType as SupportedMimeTypes,
  )
  if (
    isAcceptableFormat &&
    !metadata?.isHDR &&
    file.fileSize != null &&
    file.fileSize < MIN_SIZE_FOR_COMPRESSION_BYTES
  ) {
    return {
      uri: file.uri,
      size: file.fileSize,
      mimeType: file.mimeType ?? 'video/mp4',
      passthroughReason: 'below-byte-threshold',
    }
  }

  return compress(
    file.uri,
    {
      targetBitrate: COMPRESSION_TARGET_BITRATE,
      maxSize: COMPRESSION_MAX_DIMENSION,
      codec: 'auto',
      frameRateCap: 30,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      // Force a transcode regardless of size. Anything reaching this call
      // needs to be re-encoded: unacceptable formats would be rejected by the
      // server, and HDR sources would keep the colors we came here to tone
      // map. Acceptable non-HDR formats are short-circuited above.
      passthroughBelowBytes: 0,
      passthroughGif: false,
    },
    {onProgress, signal},
  )
}

function toProbedMetadata(metadata: VideoMetadata): ProbedMetadata {
  return metadata
}
