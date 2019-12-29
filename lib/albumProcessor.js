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

    const isFlac = format === 'flac';

    this.albumMeta = isFlac ? this.flacAlbumMeta : this.mp3AlbumMeta;
    this.trackMeta = isFlac ? this.flacTrackMeta : this.mp3TrackMeta;
    this.embedMetadata = isFlac ? this.embedFlacMetadata : this.embedMp3Metadata;
  }

  flacAlbumMeta({ album, albumArtist, genre, discNumber, trackTotal }) {
    return {
      ALBUM: album,
      ALBUMARTIST: albumArtist,
      GENRE: genre,
      DISCNUMBER: String(discNumber),
      TRACKTOTAL: trackTotal
    };
  }

  mp3AlbumMeta({ album, albumArtist, genre, discNumber }) {
    const tags = {
      TALB: album,
      TCON: genre,
      TPE2: albumArtist,
      TPOS: String(discNumber)
    };

    if (albumArtist === 'Various Artists') {
      tags.TCMP = '1';
    }

    return tags;
  }

  flacTrackMeta({ title, artist, position }) {
    return {
      TITLE: title,
      TRACKNUMBER: String(position),
      ARTIST: artist
    };
  }

  mp3TrackMeta({ title, artist, position }) {
    return {
      TIT2: title,
      TRCK: String(position),
      TPE1: artist
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
    const imageBinary = await this.storeAlbumArt(albumDir, album_art);

    console.log(main_artist, albumTitle);

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

  async storeAlbumArt(directory, url) {
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

    console.log(position, title);
    // console.log('\tRequesting url');

    const { track: trackData } = await getTrackUrl({
      discId,
      trackId,
      token,
      format
    });

    try {
      // console.log('\tDownloading');
      const trackBuffer = await rp({
        uri: trackData.url,
        encoding: null
      });

      const { discNumber, multiDisc, imageBinary } = metaData;

      // console.log('\tEmbed metadata');

      const trackFile = this.embedMetadata(trackBuffer, trackMetadata, imageBinary);

      const discPrefix = multiDisc ? `${padNum(discNumber)}-` : '';
      const fileName = `${discPrefix}${padNum(position)} ${sanitize(title)}`;
      const trackPath = path.join(albumDir, fileName);

      // console.log('\tSave file');

      return await this.createTrackFile(trackPath, trackFile);
    } catch (error) {
      // console.error(error);
      throw error;
    }
  }

  embedMetadata() {
    console.error('processor.embedMetadata should be replaced on init');
  }

  embedFlacMetadata(track, metadata, image) {
    const file = new Metaflac(track);

    for (let [key, value] of Object.entries(metadata)) {
        file.setTag(`${key}=${value}`);
    }

    file.importPictureFromBuffer(image);
    
    return file.save();
  }

  embedMp3Metadata(track, metadata, image) {
    const tags = {
      ...metadata,
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
