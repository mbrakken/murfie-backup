const fs = require('fs').promises;
const path = require('path');
const rp = require('request-promise-native');
const Metaflac = require('metaflac-js');
const NodeID3 = require('node-id3');

const createDirectory = require('./createDirectory');
const { getDisc, getTrackUrl } = require('./api');
const sanitize = require('./sanitize');

const DISC_NUM_REGEX = /, Disc \d+$/;

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

    this.albumMeta = format === 'flac' ? this.flacAlbumMeta : this.mp3AlbumMeta;
    this.trackMeta = format === 'flac' ? this.flacTrackMeta : this.mp3TrackMeta;
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

  mp3AlbumMeta({ album, albumArtist, genre, discNumber }) {
    return {
      album,
      genre,
      album_artist: albumArtist,
      disc: discNumber,
      compilation: albumArtist === 'Various Artists' ? 1 : undefined
    };
  }

  flacTrackMeta({ title, artist, position }) {
    return {
      TITLE: title,
      TRACKNUMBER: position,
      ARTIST: artist
    };
  }

  mp3TrackMeta({ title, artist, position }) {
    return {
      title,
      track: position,
      artist
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
    const imageBinary = await this.addAlbumArt(albumDir, album_art);

    console.log(albumDir);

    const metaData = {
      album: cleanTitle,
      albumArtist: main_artist,
      genre,
      discNumber: getDiscNumber(albumTitle),
      trackTotal: tracks.length,
      multiDisc,
      imageBinary
    };

    for (const track of tracks) {
      await this.processTrack({ discId, track, metaData, albumDir });
    }
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

    await fs.writeFile(path.join(directory, 'cover.jpg'), imgData, {
      encoding: null
    });

    return imgData;
  }

  async processTrack({ discId, track, metaData, albumDir }) {
    const { token, format } = this;
    const { id: trackId, title, position, artist } = track;

    const trackMetadata = {
      ...this.albumMeta(metaData),
      ...this.trackMeta({ title, artist, position })
    };

    const tags = Object.keys(trackMetadata)
      .filter(key => typeof trackMetadata[key] !== 'undefined')
      .map(key => ({
        key,
        value: trackMetadata[key]
      }));

    const { track: trackData } = await getTrackUrl({
      discId,
      trackId,
      token,
      format
    });

    try {
      const trackBuffer = await rp({
        uri: trackData.url,
        encoding: null,
        headers: {
          'x-mms-meta': JSON.stringify({
            tags,
            encoding: {}
          })
        }
      });

      const { discNumber, multiDisc, imageBinary } = metaData;

      const trackFile = this.embedAlbumArt(trackBuffer, imageBinary);

      const discPrefix = multiDisc ? `${padNum(discNumber)}-` : '';
      const fileName = `${discPrefix}${padNum(position)} ${sanitize(title)}`;
      const trackPath = path.join(albumDir, fileName);

      return await this.createTrackFile(trackPath, trackFile);
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  embedAlbumArt(track, image) {
    const { format } = this;

    if (format   === 'flac') {
      const file = new Metaflac(track);
      file.importPictureFromBuffer(image);
      return file.save();
    } else {
      const tags = {
        image: {
          mime: 'jpeg',
          type: {
            id: 3,
            name: 'front cover'
          },
          imageBuffer: image
        }
      };
      return NodeID3.update(tags, track);
    }
  }

  async createTrackFile(filePath, data, attempts = 0) {
    const { format } = this;
    try {
      const increment = attempts > 0 ? '_' + attempts : '';

      // when writing files, we'll want to use the 'wx' and handle if we'd overwrite an existing file
      // eg. to handle different versions of an album where murfie doesn't properly differentiate
      return await fs.writeFile(`${filePath}${increment}.${format}`, data, {
        encoding: null,
        flag: 'wx'
      });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      return await this.createTrackFile(filePath, data, attempts + 1);
    }
  }
}

module.exports = Processor;
