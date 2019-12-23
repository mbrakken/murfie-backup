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

const BLOCK_TYPES = {
  STREAMINFO: 'STREAMINFO',
  PADDING: 'PADDING',
  APPLICATION: 'APPLICATION',
  SEEKTABLE: 'SEEKTABLE',
  VORBIS_COMMENT: 'VORBIS_COMMENT',
  CUESHEET: 'CUESHEET',
  PICTURE: 'PICTURE'
};

const blockTypeMap = Object.freeze({
  0: BLOCK_TYPES.STREAMINFO,
  1: BLOCK_TYPES.PADDING,
  2: BLOCK_TYPES.APPLICATION,
  3: BLOCK_TYPES.SEEKTABLE,
  4: BLOCK_TYPES.VORBIS_COMMENT,
  5: BLOCK_TYPES.CUESHEET,
  6: BLOCK_TYPES.PICTURE
});

// first 4 bytes are always
const STREAMINFO_OFFSET = 4;

function blockTypes(num) {
  if (typeof num !== 'number') {
    console.warn('did not recieve a number, recieved', num);
    return null;
  }

  const type = blockTypeMap[num];

  if (type) return type;

  if (num > 6 && num < 127) {
    console.log(`Received`, num, 'which is valid, reserved but unspecified');
    return null;
  }

  if (num >= 127) {
    console.warn('Received invalid number', num);
    return null;
  }

  console.warn('Recieved unexpected input:', num);
  return null;
}

function isFlac(data) {
  return data.constructor === Buffer && data.toString('ascii', 0, 4) === FLAC;
}

function metaDataHeader(data, offset) {
  if (!isFlac(data)) throw new Error('Not a FLAC file');

  const byte = data.readUInt8(offset);

  return {
    isLast: byte > 127,
    type: blockTypes(byte % 128),
    totalBytes: data.readUIntBE(offset + 1, 3)
  };
}

function getChannels(block) {
  // 3 bit number
  // bits 5,6,7 from byte at index 12, xxxx111x

  // given bytes eg 01000010, 01000010 >> 1 will drop the right-most bit
  // then 0100001 & 0000111 (7) will set to zero any bit where both are not 1,
  // effectively slicing off the left-most 4 bits (setting them to 0)
  // while preserving the right-most 3. Then we add 1 because
  // "<3> : (number of channels)-1"

  return ((block[12] >> 1) & 7) + 1;
}

function getBitsPerSample(block) {
  // 5 bit number, from butes at index 12 and 13
  // get 16 bits, xxxxxxx11111xxxx
  // shift off the right-most 4, xxxxxxx11111
  // then bit-and against 11111, which zeroes out the left 7 bits
  // and add 1 because "<5> : (bits per sample)-1."

  return ((block.readUInt16BE(12) >> 4) & 0x1f) + 1;
}

function getSamplesPerStream(block) {
  // 36 bits. grab 40 (5 bytes from index 13)
  // and zero out the first 4 bytes
  return block.readUIntBE(13, 5) & 0x0fffffffff;
}

function decodeStreamInfo(block) {
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
    channels: getChannels(block),
    bitsPerSample: getBitsPerSample(block), // 5 bits
    samplesPerStream: getSamplesPerStream(block), // 4 bits + 4 bytes
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
function decodeComments(block) {
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

function decodePicture(block) {
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

function encodeComments(commentsList) {}

function metadataForType(type, block) {
  switch (type) {
    case BLOCK_TYPES.STREAMINFO:
      return decodeStreamInfo(block);

    case BLOCK_TYPES.PADDING:
      // should be all zero bits, multiple of 8
      return {
        padding: block.length * 8
      };

    case BLOCK_TYPES.APPLICATION:
      console.log(type, block);

      return {
        application: block.toString('utf8', 0, 4)
      };

    case BLOCK_TYPES.VORBIS_COMMENT:
      return decodeComments(block);

    case BLOCK_TYPES.PICTURE:
      return decodePicture(block);

    case BLOCK_TYPES.CUESHEET:
    case BLOCK_TYPES.SEEKTABLE:
    case BLOCK_TYPES.PICTURE:
      console.log('metadata collector not implemented for', type);
      return {};

    default:
      console.warn('unknown type', type);
      return {};
  }
}

function blockInfo(data, offset = STREAMINFO_OFFSET) {
  if (!isFlac(data)) throw new Error('Not a FLAC file');

  const { totalBytes, type, isLast } = metaDataHeader(data, offset);

  offset += 4;
  const block = data.slice(offset, offset + totalBytes);

  return {
    block,
    totalBytes,
    type,
    isLast,
    metadata: metadataForType(type, block)
  };
}

function logBlockData(fileBuffer) {
  let isLast = false;
  let offset = STREAMINFO_OFFSET;
  const headerBytes = 4;
  const output = {};

  while (!isLast) {
    let info = blockInfo(fileBuffer, offset);

    if (!output[info.type]) {
      output[info.type] = info;
    } else {
      output[info.type] = [].concat(output[info.type], info);
    }

    offset = offset + headerBytes + info.totalBytes;
    isLast = info.isLast;
  }

  return output;
}

module.exports = {
  blockInfo,
  logBlockData
};

// const fs = require('fs')
// const path = require('path')
// const flac = require('./lib/flac')
// var filePath = path.resolve('..', '..', '..', 'Downloads', 'Beyoncé-Formation.flac')
// var buf = fs.readFileSync(filePath)
// var data = flac.logBlockData(buf)
