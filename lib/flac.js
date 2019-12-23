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
}

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

function _blockTypes(num) {
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

// function bits(data, blockStart = STREAMINFO_OFFSET) {
//   // read 1 byte, convert to binary, and pad to 8 digits;
//   return data
//     .readUIntBE(blockStart, 1)
//     .toString(2)
//     .padStart(8, 0);
// }

function toBinary(byte, bits = 8) {
  return byte.toString(2).padStart(bits, '0');
}

function isFlac(data) {
  return data.constructor === Buffer && data.toString('utf8', 0, 4) === FLAC;
}

function isLastHeader(data, blockStart = STREAMINFO_OFFSET) {
  // take first byte
  const byte = data[blockStart];
  const binary = toBinary(byte, 8);

  return binary[0] === '1';
}

// function metaHeader(data, blockStart = STREAMINFO_OFFSET) {
//   return data.readUIntBE(blockStart,1).toString(2).padStart(8,0);
// }

function metaBlockType(data, blockStart = STREAMINFO_OFFSET) {
  const byte = data[blockStart];
  const binary = toBinary(byte, 8);
  const bits = binary.slice(1);

  return _blockTypes(Number.parseInt(bits, 2));
}

function metaBlockSize(data, blockStart = STREAMINFO_OFFSET) {
  const offset = blockStart + 1; // first byte specifies type of meta block

  return data.readUIntBE(offset, 3); // 24 bits in digit
}

function metaDataHeader(data, blockStart) {
  if (!isFlac(data)) throw new Error('Not a FLAC file');

  return {
    isLast: isLastHeader(data, blockStart),
    type: metaBlockType(data, blockStart),
    totalBytes: metaBlockSize(data, blockStart)
  };
}

function metaDataBlock(data, blockStart, bytes) {
  const offset = blockStart + 4; // offset the 4 header bytes

  return data.slice(offset, offset + bytes);
}

function getSampleRate(block) {
  // starts on 11th byte [index 10] and is a 20 bit integer (2 bytes + 4 bits)
  const bits = [].slice
    .call(block, 10, 13)
    .map(b => toBinary(b, 8))
    .join('')
    .slice(0, 20);

  return Number.parseInt(bits, 2);
}

function getChannels(block) {
  // 3 bit number
  // bits 5,6,7 from byte at index 12

  const byte = block[12];
  const bits = toBinary(byte, 8).slice(4, 7);

  // supports 1 to 8, 111 is 7, so add 1
  return 1 + Number.parseInt(bits, 2);
}

function getBitsPerSample(block) {
  // 5 bit number
  // bit 8 from byte at index 12
  // and bits 1 to 4 from byte at index 13

  const bits = [].slice
    .call(block, 12, 14)
    .map(b => toBinary(b, 8))
    .join('')
    .slice(7, 12);

  // supports 4 to 32. 11111 is 31, so add 1
  return 1 + Number.parseInt(bits, 2);
}

function getSamplesPerStream(block) {
  // 36 bits
  // the last 4 bits from byte at index 13
  // and the following 4 bytes
  const bits = [].slice
    .call(block, 13, 18)
    .map(b => toBinary(b, 8))
    .join('')
    .slice(4);

  return Number.parseInt(bits, 2);
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
  const B_32 = 4;
  const vEnd = block.readUInt32LE(0) + B_32
  const commentLength = block.readUInt32LE(vEnd);
  const comments = new Array(commentLength);

  let commentOffset = vEnd + B_32;

  for (let index = 0; index < commentLength; index++) {
    const length = block.readUInt32LE(commentOffset);
    const cStart = commentOffset + B_32;
    const cEnd = cStart + length;

    comments[index] = block.toString('utf8', cStart, cEnd)
    commentOffset = cEnd;
  }

  return {
    vendor: block.toString('utf8', B_32, vEnd),
    comments
  };
}

function encodeComments(commentsList) {

}

function metadataForType(type, block) {
  switch (type) {
    case BLOCK_TYPES.STREAMINFO:
      // block is always 34 bytes
      return {
        blockSize: {
          min: block.readUInt16BE(0), // 2 bytes
          max: block.readUInt16BE(2) // 2 bytes
        },
        frameSize: {
          min: block.readUIntBE(4, 3), // 3 bytes
          max: block.readUIntBE(7, 3) // 3 bytes
        },
        sampleRate: getSampleRate(block), // 2 bytes + 4 bits
        channels: getChannels(block), // 3 bits
        bitsPerSample: getBitsPerSample(block), // 5 bits
        samplesPerStream: getSamplesPerStream(block), // 4 bits + 4 bytes
        signature: block.toString('hex', 18) // 16 bytes
      };

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

  const block = metaDataBlock(data, offset, totalBytes);

  return {
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
      output[info.type] = [].concat(output[info.type], info)
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