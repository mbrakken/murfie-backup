/**
 *
 * https://xiph.org/flac/format.html#metadata_block_data
 *
 * All numbers used in a FLAC bitstream are integers; there are no floating-point representations.
 * All numbers are big-endian coded.
 * All numbers are unsigned unless otherwise specified.
 *
 * The first 4 bytes (32 bits) are 'fLaC' in ASCII
 * eg data.toString('ascii', 0 ,4) === 'fLaC'
 *
 * or more verbosely:
 *   [...data.slice(0,4)]
 *     .map(n => String.fromCodePoint('0x' + n.toString(16)))
 *     .join('')
 *
 * This is followed by at least 1 metadata block begining with STREAMINFO
 *
 * Each metadata block is composed of a header and the data
 *
 * The header is 4 bytes (32 bits) compose of the following:
 *   First bit: 0 or 1. If 1, signals that it's the last metadata block
 *   Next 7 bits: an UIntBE between 0 and 127 that specifies the type of metadata block
 *
 *   The next 3 bytes (24 bits) tell the length in bytes of the following metadata
 *
 * The STREAMINFO block is 34 bytes (272 bits) and composed of the following:
 *   16 bits (2 bytes) : minimum block size in the stream (FLAC minimum of 16)
 *   16 bits (2 bytes) : maximum block size in the stream (FLAC minimum of 16)
 *   24 bits (3 bytes) : minimum frame size in the stream (0 means unknown)
 *   24 bits (3 bytes) : maximum frame size in the stream (0 means unknown)
 *   20 bits : sample rate in Hz. 0 is invalid
 *   3 bits: number of channels (FLAC supports 1 to 8)
 *   5 bits: number of bits per sample, 4 to 32
 *   36 bits: Total samples in the stream. 0 means unknown
 *   128 bits: MD5 signature of unencoded data
 */

const FLAC = 'fLaC';

const BLOCK_TYPES = Object.freeze({
  0: 'STREAMINFO',
  1: 'PADDING',
  2: 'APPLICATION',
  3: 'SEEKTABLE',
  4: 'VORBIS_COMMENT',
  5: 'CUESHEET',
  6: 'PICTURE'
});

const STREAMINFO = 0;
const PADDING = 1;
const APPLICATION = 2;
const SEEKTABLE = 3;
const VORBIS_COMMENT = 4;
const CUESHEET = 5;
const PICTURE = 6;

// first 4 bytes are always
const STREAMINFO_OFFSET = 4;

class Flac {
  constructor(fileBuffer) {
    if (!Buffer.isBuffer(fileBuffer)) {
      throw new Error('Flac(file) must be a buffer');
    }

    this.buffer = fileBuffer;
    this.parsed = this.parseFile(this.buffer);
  }

  isFlac(data) {
    return data.toString('ascii', 0, 4) === FLAC;
  }

  blockTypes(typeNum) {
    if (typeof typeNum !== 'number') {
      console.warn('did not recieve a number, recieved', typeNum);
      return null;
    }
  
    const type = BLOCK_TYPES[typeNum];
  
    if (type) return type;
  
    if (typeNum > 6 && typeNum < 127) {
      console.log(`Received`, typeNum, 'which is valid, reserved but unspecified');
      return 'UNSPECIFIED';
    }
  
    if (typeNum >= 127) {
      console.warn('Received invalid number', typeNum);
      return null;
    }
  
    console.warn('Recieved unexpected input:', typeNum);
    return null;
  }

  parseFile(fileBuffer) {
    let isLast = false;
    let offset = STREAMINFO_OFFSET;
    const headerBytes = 4;
    const output = {};
  
    while (!isLast) {
      let info = this.blockInfo(fileBuffer, offset);
  
      if (!output[info.typeName]) {
        output[info.typeName] = info;
      } else {
        output[info.typeName] = [].concat(output[info.typeName], info);
      }
  
      offset = offset + headerBytes + info.totalBytes;
      isLast = info.isLast;
    }
  
    this.media = fileBuffer.slice(offset);
  
    return output;
  }

  blockInfo(data, offset = STREAMINFO_OFFSET) {
    if (!this.isFlac(data)) {
      throw new Error('Not a FLAC file');
    }

    const { totalBytes, type, typeName, isLast } = this.metaDataHeader(data, offset);

    offset += 4;

    const block = data.slice(offset, offset + totalBytes);
  
    return {
      block,
      totalBytes,
      type,
      typeName,
      isLast,
      metadata: this.metadataForType(type, block)
    };
  }

  metaDataHeader(data, offset) {
    const byte = data.readUInt8(offset);
    const type = byte % 128;
  
    return {
      isLast: byte > 127,
      type: byte % 128,
      typeName: this.blockTypes(type),
      totalBytes: data.readUIntBE(offset + 1, 3)
    };
  }

  metadataForType(typeNum, block) {
    switch (typeNum) {
      case STREAMINFO:
        return this.decodeStreamInfo(block);
  
      case PADDING:
        // should be all zero bits, multiple of 8
        return {
          padding: block.length * 8
        };
  
      case APPLICATION:
        console.log(typeNum, block);
  
        return {
          application: block.toString('utf8', 0, 4)
        };
  
      case VORBIS_COMMENT:
        return this.decodeComments(block);
  
      case PICTURE:
        return this.decodePicture(block);
  
      case CUESHEET:
      case SEEKTABLE:
      case PICTURE:
        console.log('metadata collector not implemented for', typeNum);
        return {};
  
      default:
        console.warn('unknown type', typeNum);
        return {};
    }
  }

  decodeStreamInfo(block) {
    // block is always 34 bytes
    let offset = 0;
  
    return {
      blockSize: {
        min: block.readUInt16BE(offset),
        max: block.readUInt16BE((offset += 2))
      },
      frameSize: {
        min: block.readUIntBE((offset += 2), 3),
        max: block.readUIntBE((offset += 3), 3)
      },
      sampleRate: block.readUIntBE((offset += 3), 3) >> 4, // 2 bytes + 4 bits
      channels: this.channels(block),
      bitsPerSample: this.bitsPerSample(block), // 5 bits
      samplesPerStream: this.samplesPerStream(block), // 4 bits + 4 bytes
      signature: block.toString('hex', 18, 34) // 16 bytes
    };
  }

  /**
   *
   * Also known as FLAC tags, the contents of a vorbis comment packet as specified here
   * [http://www.xiph.org/vorbis/doc/v-comment.html] (without the framing bit).
   * Note that the vorbis comment spec allows for on the order of 2 ^ 64 bytes of data
   * where as the FLAC metadata block is limited to 2 ^ 24 bytes.
   *
   * Given the stated purpose of vorbis comments, i.e. human-readable textual information,
   * this limit is unlikely to be restrictive.
   *
   * Also note that the 32-bit field lengths are little-endian coded according to the vorbis spec,
   * as opposed to the usual big-endian coding of fixed-length integers in the rest of FLAC.
   *
   */
  decodeComments(block) {
    let offset = 0;
  
    const vLength = block.readUInt32LE(offset);
    const vendor = block.toString('utf8', (offset += 4), (offset += vLength));
  
    const cLength = block.readUInt32LE(offset);
    const comments = new Array(cLength);
  
    offset += 4;
  
    for (let index = 0; index < cLength; index++) {
      const length = block.readUInt32LE(offset);
  
      comments[index] = block.toString('utf8', (offset += 4), (offset += length));
    }
  
    return {
      vendor,
      comments
    };
  }

  decodePicture(block) {
    let offset = 0;
    const pictureType = block.readUInt32BE(offset);
  
    const mimeLength = block.readUInt32BE((offset += 4));
    const mimeType = block.toString(
      'ascii',
      (offset += 4),
      (offset += mimeLength)
    );
  
    const descriptionLength = block.readUInt32BE(offset);
    const description = block.toString(
      'utf8',
      (offset += 4),
      (offset += descriptionLength)
    );
  
    const width = block.readUInt32BE(offset);
    const height = block.readUInt32BE((offset += 4));
  
    const colorDepth = block.readUInt32BE((offset += 4));
    const colorsUsed = block.readUInt32BE((offset += 4));
  
    const length = block.readUInt32BE((offset += 4));
    const imageData = block.slice((offset += 4));
  
    if (imageData.length !== length) {
      console.warn(
        `image data size ${imageData.length} does not meet expected number of bytes ${length}`
      );
    }
  
    return {
      pictureType,
      mimeType,
      description,
      width,
      height,
      colorDepth,
      colorsUsed,
      length,
      imageData
    };
  }

  channels(block) {
    // 3 bit number, bits 5,6,7 from byte at index 12
    // get the byte, xxxx101x
    // shift off the right-most bit
    // xxxx101x >> 1 -> xxxx101
    // bit-and against 7 (0000111) to zero out the left 4 bits
    // xxxx101 & 0000111 -> 0000101
    // Then add 1 because "<3> : (number of channels)-1"
  
    return ((block[12] >> 1) & 7) + 1;
  }

  bitsPerSample(block) {
    // 5 bit number, from bytes at index 12 (right-most bit) and 13 (4 left-most bits)
    // get 16 bits, xxxxxxx11111xxxx
    // shift off the right-most 4, xxxxxxx11111
    // then bit-and against 11111, which zeroes out the left 7 bits
    // and add 1 because "<5> : (bits per sample)-1."
  
    return ((block.readUInt16BE(12) >> 4) & 0x1f) + 1;
  }
  
  samplesPerStream(block) {
    // 36 bits. grab 40 (5 bytes starting with index 13)
    // and zero out the first 4 bytes
    return block.readUIntBE(13, 5) & 0x0fffffffff;
  }

  buildMetadataBlock(blockData, isLast = false) {
    if (!blockData || !blockData.block) {
      return Buffer.alloc(0);
    }

    const { type, block } = blockData;

    const header = Buffer.alloc(4);

    if (isLast) {
      type += 128;
    }

    header.writeUIntBE(type, 0, 1);
    header.wriiteUIntBE(block.length, 1, 3);
    
    return Buffer.concat([header, block]);
  }

  buildMetadata() {
    const { parsed } = this;

    if (!parsed.STREAMINFO) {
      throw new Error('Missing required header STREAMINFO');
    }

    const metadata = [];

    // start
    metadata.push(buildMetadataBlock(parsed.STREAMINFO));
    metadata.push(this.buildMetadataBlock(parsed.APPLICATION));
    metadata.push(this.buildMetadataBlock(parsed.CUESHEET));
    metadata.push(this.buildMetadataBlock(parsed.SEEKTABLE));
    metadata.push(this.buildMetadataBlock(parsed.VORBIS_COMMENT));
    
    [].concat(parsed.PICTURES).filter(Boolean).forEach(picture => {
      metadata.push(this.buildMetadataBlock(picture));
    });
   
    metadata.push(buildMetadataBlock(parsed.PADDING, true));
     // end

    return metadata;
  }

  composeFile() {
    let start = Buffer.from(FLAC);
    const { media } = this;
    const metadataArray = this.buildMetadata();

    return Buffer.concat([start, ...metadataArray, media]);
  }


}

function encodeComments(commentsList) {}

module.exports = Flac;

// const fs = require('fs')
// const path = require('path')
// const Metaflac = require('metaflac-js')
// var filePath = path.resolve('..', '..', '..', 'Downloads', 'Beyoncé-Formation.flac')
// var buf = fs.readFileSync(filePath)
// var flac = new Metaflac(buf)
