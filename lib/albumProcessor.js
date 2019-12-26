const fs = require('fs').promises;
const path = require('path');
const rp = require('request-promise-native');
const createDirectory = require('./createDirectory');
const { getDisc, getTrackUrl } = require('./api');
const sanitize = require('./sanitize');

const flac = require('./flac');

const DISC_NUM_REGEX = /, Disc \d+$/;

// function mainArtistFromTracks(tracks) {
//   const count = tracks.reduce((obj, track) => {
//     if (obj[track.artist] === undefined) {
//       obj[track.artist] = 0;
//     }

//     ++obj[track.artist];
//     return obj;
//   }, {});

//   const mostCommon = Object.keys(count)
//     .map(artist => ({
//       artist,
//       count: count[artist]
//     }))
//     .sort((a, b) => b.count - a.count)[0];

//   if (mostCommon.count > Math.floor(tracks.length / 2)) {
//     return mostCommon.artist;
//   } else {
//     return 'Various Artists';
//   }
// }

function getDiscNumber(album) {
  const match = album.match(DISC_NUM_REGEX);

  if (!match) return '1';

  return match[0].match(/\d+/)[0];
}

function padNum(num) {
  return String(num).padStart(2, '0');
}

class Processor {
  constructor(token, baseDir, format) {
    this.token = token;
    this.baseDir = baseDir;
    this.format = format;

    this.albumMeta = format === 'flac' ? this.flacAlbumMeta : a => a;
    this.trackMeta = format === 'flac' ? this.flacTrackMeta : a => a;
  }

  flacAlbumMeta({ album, albumArtist, genre, discNumber, trackTotal }) {
    return {
      ALBUM: album,
      ALBUMARTIST: albumArtist,
      GENRE: genre,
      DISCNUMBER: discNumber,
      TRACKTOTAL: trackTotal
    };
  }

  flacTrackMeta({ title, artist, position }) {
    return {
      TITLE: title,
      TRACKNUMBER: position,
      ARTIST: artist
    };
  }

  async processDisc(item) {
    const { token } = this;

    const { disc } = await getDisc({
      discId: item.disc.id,
      token
    });

    const { id: discId, album, tracks } = disc;
    const { main_artist, title: albumTitle, genre, album_art } = album;

    // remove ", Disc 1" stuff
    const cleanTitle = albumTitle.replace(DISC_NUM_REGEX, '');
    const multiDisc = !!albumTitle.match(DISC_NUM_REGEX);

    const artistDir = await this.createArtistDirectory(main_artist);
    const albumDir = await this.createAlbumDirectory(artistDir, cleanTitle);
    await this.addAlbumArt(albumDir, album_art);

    const metaData = {
      album: cleanTitle,
      albumArtist: main_artist,
      genre,
      discNumber: getDiscNumber(albumTitle),
      trackTotal: tracks.length,
      multiDisc
    };

    // for (const track of tracks) {
    //   await this.processTrack({ discId, track, metaData, albumDir });
    // }
    }

  async createArtistDirectory(artist) {
    const { baseDir } = this;

    const pathName = path.join(baseDir, sanitize(artist));

    await createDirectory(pathName);

    return pathName;
  }

  async createAlbumDirectory(artistPath, album) {
    const pathName = path.join(artistPath, sanitize(album));

    await createDirectory(pathName);

    return pathName;
  }

  async addAlbumArt(directory, url) {
    url = url.replace(/-large.jpg$/, '-huge.jpg');

    const imgData = await rp.get(url, { encoding: null });

    return await fs.writeFile(path.join(directory, 'cover.jpg'), imgData, {
      encoding: null
    });
  }

  async processTrack({ discId, track, metaData, albumDir }) {
    const { token, format } = this;
    const { id: trackId, title, position, artist } = track;

    const trackMetadata = {
      ...this.albumMeta(metaData),
      ...this.trackMeta({ title, artist, position })
    };

    const tags = Object.keys(trackMetadata).map(key => ({
      key,
      value: trackMetadata[key]
    }));

    const { track: trackData } = await getTrackUrl({
      discId,
      trackId,
      token,
      format
    });

    let trackBuffer;

    try {
      trackBuffer = await rp({
        uri: trackData.url,
        encoding: null,
        headers: {
          'x-mms-meta': JSON.stringify({
            tags,
            encoding: {}
          })
        }
      });

      // album art?
      // const flacHeaders = flac.logBlockData(data);
    } catch (error) {
      console.error(error);
      throw error;
    }

    const { discNumber, multiDisc } = metaData;
    const discPrefix = multiDisc ? `${padNum(discNumber)}-` : '';
    const fileName = `${discPrefix}${padNum(position)} ${sanitize(title)}`;

    return await this.createTrackFile(fileName, trackBuffer);
  }

  async createTrackFile(filename, data, attempts = 0) {
    const { format } = this;
    try {
      const fname = attempts > 0 ? filename + '_' + attempts : filename;

      // when writing files, we'll want to use the 'wx' and handle if we'd overwrite an existing file
      // eg. to handle different versions of an album where murfie doesn't properly differentiate
      return await fs.writeFile(`${fname}.${format}`, data, {
        encoding: null,
        flag: 'wx'
      });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      return await this.createTrackFile(filename, data, attempts + 1);
    }
  }
}

module.exports = Processor;
