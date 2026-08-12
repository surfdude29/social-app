import {type ImagePickerAsset} from 'expo-image-picker'

import {compressVideo} from '../compress'
import {type ProbedMetadata} from '../types'

jest.mock('@bsky.app/video-compressor', () => ({
  probe: jest.fn(),
  compress: jest.fn(),
}))

jest.mock('#/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}))

const {probe, compress}: {probe: jest.Mock; compress: jest.Mock} =
  jest.requireMock('@bsky.app/video-compressor')

const MIN_SIZE_FOR_COMPRESSION_BYTES = 25 * 1024 * 1024

/**
 * Mirrors the sample that surfaced this bug - an HEVC Main 10 / BT.2020 PQ
 * iPhone screen recording that sits just under the byte threshold.
 */
function metadata(overrides?: Partial<ProbedMetadata>): ProbedMetadata {
  return {
    mimeType: 'video/quicktime',
    codec: 'hvc1',
    width: 1206,
    height: 2144,
    duration: 24.84,
    bitrate: 7_700_000,
    fileSize: 23_995_732,
    hasAudio: true,
    frameRate: 60,
    rotation: 0,
    isHDR: false,
    ...overrides,
  }
}

function asset(overrides?: Partial<ImagePickerAsset>): ImagePickerAsset {
  return {
    uri: 'file:///tmp/ScreenRecording.mov',
    width: 1206,
    height: 2144,
    mimeType: 'video/quicktime',
    fileSize: 23_995_732,
    ...overrides,
  } as ImagePickerAsset
}

const compressed = {
  uri: 'file:///tmp/out.mp4',
  size: 8_000_000,
  mimeType: 'video/mp4',
}

describe('compressVideo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    probe.mockResolvedValue(metadata())
    compress.mockResolvedValue(compressed)
  })

  it('compresses a small HDR video instead of passing it through', async () => {
    probe.mockResolvedValue(metadata({isHDR: true}))

    const result = await compressVideo(asset())

    expect(compress).toHaveBeenCalled()
    expect(result.passthroughReason).toBeUndefined()
    expect(result).toEqual(compressed)
  })

  it('skips compression for a small non-HDR video', async () => {
    const result = await compressVideo(asset())

    expect(compress).not.toHaveBeenCalled()
    expect(result).toEqual({
      uri: 'file:///tmp/ScreenRecording.mov',
      size: 23_995_732,
      mimeType: 'video/quicktime',
      passthroughReason: 'below-byte-threshold',
    })
  })

  it('falls back to the size-only rule when probing fails', async () => {
    probe.mockRejectedValue(new Error('No video track found'))

    const result = await compressVideo(asset())

    expect(compress).not.toHaveBeenCalled()
    expect(result.passthroughReason).toBe('below-byte-threshold')
  })

  it('passes GIFs through without probing', async () => {
    const result = await compressVideo(
      asset({mimeType: 'image/gif', fileSize: 1_000}),
    )

    expect(probe).not.toHaveBeenCalled()
    expect(compress).not.toHaveBeenCalled()
    expect(result).toEqual({
      uri: 'file:///tmp/ScreenRecording.mov',
      size: 1_000,
      mimeType: 'image/gif',
      passthroughReason: 'gif',
    })
  })

  it('compresses small unacceptable-format videos', async () => {
    probe.mockResolvedValue(metadata({mimeType: 'video/x-matroska'}))

    const result = await compressVideo(asset({mimeType: 'video/x-matroska'}))

    expect(compress).toHaveBeenCalled()
    expect(result.passthroughReason).toBeUndefined()
  })

  it('compresses videos at or above the byte threshold', async () => {
    const result = await compressVideo(
      asset({fileSize: MIN_SIZE_FOR_COMPRESSION_BYTES}),
    )

    expect(compress).toHaveBeenCalled()
    expect(result.passthroughReason).toBeUndefined()
  })

  it('reports probed metadata to onProbe', async () => {
    const onProbe = jest.fn()
    const probed = metadata({isHDR: true})
    probe.mockResolvedValue(probed)

    await compressVideo(asset(), {onProbe})

    expect(onProbe).toHaveBeenCalledWith(probed)
  })
})
