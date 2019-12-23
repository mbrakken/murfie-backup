#!/usr/bin/env node
const { EOL } = require('os');
const api = require('./lib/api');
const { welcomeMsg, getCredentials, selectFormat } = require('./lib/ui');
const fileBrowser = require('./lib/fileBrowser');

async function loadAccount() {
  let user;
  let attempts = 0;

  while (!user && attempts < 5) {
    ++attempts;

    const { email, password } = await getCredentials();

    try {
      const { user } = await api.getProfile({ email, password });

      return user;
    } catch (e) {
      console.error(`${EOL}Error requesting account${EOL}`);
    }
  }

  if (!user) {
    console.error(`${EOL}${attempts} failed attempts. Aborting${EOL}`);
    process.exit(1);
  } else {
    return user;
  }
}

async function init() {
  console.clear();
  console.log(welcomeMsg);

  const { token, subscription_type } = await loadAccount();
  const collection = await api.getCollection({ token });

  // console.clear();
  console.log(`Loaded ${collection.length} discs${EOL}`);

  const format = await selectFormat(subscription_type);
  const directory = await fileBrowser();

  console.log('USING DIR', directory);

  const { disc } = await api.getTracks({
    discId: collection[0].disc.id,
    token
  });

  const urls = await Promise.all(
    disc.tracks.map(t =>
      api.getTrackUrl({
        discId: disc.id,
        trackId: t.id,
        token,
        format
      })
    )
  );

  console.log(urls);
}

init();
