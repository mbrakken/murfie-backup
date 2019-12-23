const rp = require('request-promise-native');

const HOST = 'https://api.murfie.com/api';

module.exports = {
  getProfile({ email, password }) {
    return rp(`${HOST}/tokens`, {
      method: 'POST',
      body: { email, password },
      json: true
    });
  },

  getCollection({ token }) {
    return rp(`${HOST}/discs.json`, {
      method: 'GET',
      qs: { auth_token: token },
      json: true
    });
  },

  getDisc({ discId, token }) {
    return rp(`${HOST}/discs/${discId}.json`, {
      method: 'GET',
      qs: { auth_token: token },
      json: true
    });
  },

  getTrackUrl({ discId, trackId, token, format }) {
    return rp(`${HOST}/discs/${discId}/tracks/${trackId}.json`, {
      method: 'GET',
      qs: { auth_token: token, media_format: format },
      json: true
    });
  }
};
