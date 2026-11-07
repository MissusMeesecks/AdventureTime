/**
 * The pictures' export metadata (88-quater): the strip drops a PNG's text
 * and EXIF chunks and a JPEG's EXIF, IPTC and comment segments, keeps every
 * other byte, and the reader names what a picture still carries. The
 * fixtures are built here, invented, never a real picture.
 */
import { crc32, deflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
    JPEG_METADATA_MARKERS,
    PNG_METADATA_CHUNKS,
    imageMetadata,
    isJpeg,
    isPng,
    jpegSegments,
    pngChunks,
    stripImageMetadata,
} from './strip-image-metadata.mjs'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** One PNG chunk as the file holds it: the length, the type, the data, the CRC over type and data. */
function chunk(type: string, data: Buffer): Buffer {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typeBytes = Buffer.from(type, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
    return Buffer.concat([length, typeBytes, data, crc])
}

/** A 2×1 grey PNG with the chunks asked for around its pixels. */
function png(extra: { before?: Buffer[]; after?: Buffer[] } = {}): { file: Buffer; ihdr: Buffer; idat: Buffer } {
    const header = Buffer.alloc(13)
    header.writeUInt32BE(2, 0)
    header.writeUInt32BE(1, 4)
    header[8] = 8 // bit depth
    header[9] = 0 // greyscale
    const ihdr = chunk('IHDR', header)
    const idat = chunk('IDAT', deflateSync(Buffer.from([0, 0x40, 0x80]))) // filter byte, two pixels
    const file = Buffer.concat([SIGNATURE, ihdr, ...(extra.before ?? []), idat, ...(extra.after ?? []), chunk('IEND', Buffer.alloc(0))])
    return { file, ihdr, idat }
}

const text = (keyword: string, value: string) => chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.alloc(1), Buffer.from(value, 'latin1')]))
const itxt = (keyword: string, value: string) => chunk('iTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0, 0]), Buffer.alloc(1), Buffer.alloc(1), Buffer.from(value, 'utf8')]))
const ztxt = (keyword: string, value: string) => chunk('zTXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0, 0]), deflateSync(Buffer.from(value, 'latin1'))]))
const exif = () => chunk('eXIf', Buffer.from('MM\0*\0\0\0\x08\0\0', 'latin1'))

/** A JPEG segment: the marker, then the length counting itself. */
function segment(marker: number, data: Buffer): Buffer {
    const head = Buffer.from([0xff, marker, 0, 0])
    head.writeUInt16BE(data.length + 2, 2)
    return Buffer.concat([head, data])
}

/** A JPEG skeleton: SOI, JFIF, the segments asked for, a quantisation table, the scan, EOI. */
function jpeg(extra: Buffer[] = []): { file: Buffer; scan: Buffer } {
    const jfif = segment(0xe0, Buffer.from('JFIF\0\x01\x02\0\0\x01\0\x01\0\0', 'latin1'))
    const dqt = segment(0xdb, Buffer.alloc(65, 1))
    const scan = Buffer.concat([segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]), Buffer.from([0xff, 0xd9])])
    return { file: Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, ...extra, dqt, scan]), scan }
}

describe('the pictures’ export metadata (88-quater)', () => {
    it('names the four PNG chunks and the three JPEG segments a maker writes', () => {
        expect(PNG_METADATA_CHUNKS).toEqual(['tEXt', 'zTXt', 'iTXt', 'eXIf'])
        expect(Object.values(JPEG_METADATA_MARKERS)).toEqual(['APP1', 'APP13', 'COM'])
    })

    it('reads a PNG’s chunks in order and names the metadata ones with their sizes, never their contents', () => {
        const { file } = png({ before: [text('Author', 'somebody'), exif()], after: [itxt('XML:com.adobe.xmp', '<x/>')] })
        expect(isPng(file)).toBe(true)
        expect(pngChunks(file).map((c) => c.type)).toEqual(['IHDR', 'tEXt', 'eXIf', 'IDAT', 'iTXt', 'IEND'])
        const found = imageMetadata(file)
        expect(found?.kind).toBe('png')
        expect(found?.found.map((f) => f.name)).toEqual(['tEXt', 'eXIf', 'iTXt'])
        expect(found?.found[0]!.size).toBe(12 + 'Author'.length + 1 + 'somebody'.length)
        expect(JSON.stringify(found)).not.toContain('somebody')
    })

    it('strips a PNG losslessly: the signature, the header, the pixels and the end byte for byte, the metadata gone', () => {
        const { file, ihdr, idat } = png({ before: [text('Comment', 'x'), ztxt('Title', 'y'), exif()], after: [itxt('Note', 'z')] })
        const stripped = stripImageMetadata(file)
        expect(stripped.subarray(0, 8).equals(SIGNATURE)).toBe(true)
        expect(pngChunks(stripped).map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
        const chunks = pngChunks(stripped)
        expect(stripped.subarray(chunks[0]!.offset, chunks[0]!.offset + chunks[0]!.size).equals(ihdr)).toBe(true)
        expect(stripped.subarray(chunks[1]!.offset, chunks[1]!.offset + chunks[1]!.size).equals(idat)).toBe(true)
        expect(imageMetadata(stripped)?.found).toEqual([])
        // Clean already: the same bytes back.
        expect(stripImageMetadata(stripped).equals(stripped)).toBe(true)
    })

    it('reads a JPEG’s segments, names EXIF, IPTC and comments, and strips them keeping JFIF, the tables and the scan whole', () => {
        const app1 = segment(0xe1, Buffer.from('Exif\0\0MM', 'latin1'))
        const app13 = segment(0xed, Buffer.from('Photoshop 3.0\0', 'latin1'))
        const com = segment(0xfe, Buffer.from('made somewhere', 'latin1'))
        const { file, scan } = jpeg([app1, app13, com])
        expect(isJpeg(file)).toBe(true)
        expect(jpegSegments(file).map((s) => s.marker)).toEqual([0xd8, 0xe0, 0xe1, 0xed, 0xfe, 0xdb, 0xda])
        expect(imageMetadata(file)?.found.map((f) => `${f.name}:${f.size}`)).toEqual([`APP1:${app1.length}`, `APP13:${app13.length}`, `COM:${com.length}`])
        const stripped = stripImageMetadata(file)
        expect(stripped.equals(jpeg().file)).toBe(true)
        expect(stripped.subarray(stripped.length - scan.length).equals(scan)).toBe(true)
        expect(imageMetadata(stripped)?.found).toEqual([])
    })

    it('leaves a file that is neither alone, and refuses a PNG whose chunks do not add up', () => {
        const other = Buffer.from('not a picture')
        expect(imageMetadata(other)).toBeNull()
        expect(stripImageMetadata(other)).toBe(other)
        const { file } = png()
        const cut = file.subarray(0, file.length - 6)
        expect(() => pngChunks(cut)).toThrow(/runs past the end/)
    })
})
