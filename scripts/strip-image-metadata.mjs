#!/usr/bin/env node
/**
 * The pictures' export metadata (88-quater, the finding of 2026-11-04): a
 * picture exported from a design tool carries the tool's own record of who
 * made it and what it was called — in a PNG, text chunks (`tEXt`, `zTXt`,
 * `iTXt`) and an EXIF chunk (`eXIf`); in a JPEG, the EXIF and XMP segment
 * (`APP1`), Photoshop's (`APP13`) and comments (`COM`). The export's
 * private-terms check reads text files only, so a picture carried them past
 * it. This script takes them out losslessly, and the export refuses a picture
 * that still has them.
 *
 *   node scripts/strip-image-metadata.mjs <picture> [<picture> …]
 *
 * Each file is rewritten in place with the metadata chunks or segments
 * dropped and everything else byte for byte: a PNG keeps its signature and
 * every other chunk whole (length, type, data, CRC), so the pixels (`IDAT`),
 * the header, the palette and the physical size are untouched; a JPEG keeps
 * every other segment and the scan whole. The report names the chunk or
 * segment types and their sizes, never their contents.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The PNG chunks that carry a maker's record: the three text chunks and EXIF. */
export const PNG_METADATA_CHUNKS = ['tEXt', 'zTXt', 'iTXt', 'eXIf']

/**
 * The JPEG segments that carry one: EXIF and XMP (APP1), Photoshop's IPTC (APP13), comments (COM).
 * @type {Record<number, string>}
 */
export const JPEG_METADATA_MARKERS = { 0xe1: 'APP1', 0xed: 'APP13', 0xfe: 'COM' }

/** @param {Buffer} buffer */
export function isPng(buffer) {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)
}

/** @param {Buffer} buffer */
export function isJpeg(buffer) {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
}

/**
 * Every chunk of a PNG in order: its type, where it starts and how long it is
 * whole (the length field, the type, the data and the CRC). A file whose
 * chunks do not add up is refused rather than guessed at.
 * @param {Buffer} buffer
 * @returns {Array<{ type: string, offset: number, size: number }>}
 */
export function pngChunks(buffer) {
    if (!isPng(buffer)) throw new Error('not a PNG')
    const chunks = []
    let at = 8
    while (at < buffer.length) {
        if (at + 8 > buffer.length) throw new Error(`malformed PNG: a chunk header runs past the end at ${at}`)
        const length = buffer.readUInt32BE(at)
        const type = buffer.subarray(at + 4, at + 8).toString('latin1')
        const size = 12 + length
        if (at + size > buffer.length) throw new Error(`malformed PNG: the ${type} chunk at ${at} runs past the end`)
        chunks.push({ type, offset: at, size })
        at += size
        if (type === 'IEND') break
    }
    return chunks
}

/**
 * Every segment of a JPEG before the scan, in order: the marker's byte, its
 * name where it is one the strip knows, where it starts and its size whole.
 * The scan (`SOS`) and everything after it are one trailing piece.
 * @param {Buffer} buffer
 * @returns {Array<{ marker: number, offset: number, size: number }>}
 */
export function jpegSegments(buffer) {
    if (!isJpeg(buffer)) throw new Error('not a JPEG')
    const segments = [{ marker: 0xd8, offset: 0, size: 2 }]
    let at = 2
    while (at < buffer.length) {
        if (buffer[at] !== 0xff) throw new Error(`malformed JPEG: no marker at ${at}`)
        const marker = buffer[at + 1]
        if (marker === 0xda) {
            // The scan: the entropy-coded data runs to the end of the file.
            segments.push({ marker, offset: at, size: buffer.length - at })
            break
        }
        if (marker === 0xd9) {
            segments.push({ marker, offset: at, size: 2 })
            break
        }
        if (at + 4 > buffer.length) throw new Error(`malformed JPEG: a segment header runs past the end at ${at}`)
        const size = 2 + buffer.readUInt16BE(at + 2)
        if (at + size > buffer.length) throw new Error(`malformed JPEG: the segment at ${at} runs past the end`)
        segments.push({ marker, offset: at, size })
        at += size
    }
    return segments
}

/**
 * What a picture carries that the export refuses: `png` or `jpeg` with the
 * metadata chunks or segments found, in order, each named with its size
 * (never its contents); `null` for a file that is neither.
 * @param {Buffer} buffer
 * @returns {{ kind: 'png' | 'jpeg', found: Array<{ name: string, size: number }> } | null}
 */
export function imageMetadata(buffer) {
    if (isPng(buffer)) {
        const found = pngChunks(buffer)
            .filter((chunk) => PNG_METADATA_CHUNKS.includes(chunk.type))
            .map((chunk) => ({ name: chunk.type, size: chunk.size }))
        return { kind: 'png', found }
    }
    if (isJpeg(buffer)) {
        const found = jpegSegments(buffer)
            .filter((segment) => segment.marker in JPEG_METADATA_MARKERS)
            .map((segment) => ({ name: JPEG_METADATA_MARKERS[segment.marker], size: segment.size }))
        return { kind: 'jpeg', found }
    }
    return null
}

/**
 * The picture without its metadata, every other byte kept: the pieces that
 * are not metadata, concatenated in their order. A file that is neither a PNG
 * nor a JPEG comes back as it is.
 * @param {Buffer} buffer
 */
export function stripImageMetadata(buffer) {
    if (isPng(buffer)) {
        const kept = pngChunks(buffer)
            .filter((chunk) => !PNG_METADATA_CHUNKS.includes(chunk.type))
            .map((chunk) => buffer.subarray(chunk.offset, chunk.offset + chunk.size))
        return Buffer.concat([PNG_SIGNATURE, ...kept])
    }
    if (isJpeg(buffer)) {
        const kept = jpegSegments(buffer)
            .filter((segment) => !(segment.marker in JPEG_METADATA_MARKERS))
            .map((segment) => buffer.subarray(segment.offset, segment.offset + segment.size))
        return Buffer.concat(kept)
    }
    return buffer
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
    const files = process.argv.slice(2)
    if (!files.length) {
        console.error('usage: node scripts/strip-image-metadata.mjs <picture> [<picture> …]')
        process.exit(2)
    }
    let failed = false
    for (const file of files) {
        try {
            const before = readFileSync(file)
            const metadata = imageMetadata(before)
            if (!metadata) {
                console.error(`${file}: not a PNG or a JPEG; left as it is`)
                failed = true
                continue
            }
            if (!metadata.found.length) {
                console.log(`${file}: no metadata to strip (${metadata.kind})`)
                continue
            }
            const after = stripImageMetadata(before)
            writeFileSync(file, after)
            const dropped = metadata.found.map(({ name, size }) => `${name} (${size} bytes)`).join(', ')
            console.log(`${file}: dropped ${dropped}; ${before.length} -> ${after.length} bytes`)
        } catch (error) {
            console.error(`${file}: ${error instanceof Error ? error.message : String(error)}`)
            failed = true
        }
    }
    process.exit(failed ? 1 : 0)
}
