#!/usr/bin/env node
const { EOL } = require('os');
const path = require('path');

const api = require('./lib/api');
const { welcomeMsg, getCredentials, selectFormat } = require('./lib/ui');
const fileBrowser = require('./lib/fileBrowser');
const createDirectory = require('./lib/createDirectory');
const Processor = require('./lib/albumProcessor');
const progressLog = require('./lib/progressLog');

const DIRECTORY_NAME = 'MurfieBackup';

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

  console.log(`Loaded ${collection.length} discs${EOL}`);

  let format = await selectFormat(subscription_type);

  let directory = await fileBrowser();
  const dlDir = `${DIRECTORY_NAME}_${format}`;

  if (path.basename(directory) !== dlDir) {
    console.log(`Albums will be added to a directory named ${dlDir}`);
    
    directory = path.join(directory, dlDir);
    await createDirectory(directory);
  }

  const processor = new Processor(token, directory, format);

  const lastDiscProcessed = await progressLog.lastDisc(directory);

  let startIdx = 0;
  let total = collection.length;

  if (lastDiscProcessed) {
    const lastId = Number.parseInt(lastDiscProcessed);
    const priorIdx = collection.findIndex(c => c.disc.id === lastId);

    if (priorIdx > -1) {
      startIdx = priorIdx + 1;
      total = total - startIdx;
    }
  }

  console.log(`${total} left to download.`);

  for (const disc of collection.slice(startIdx)) {
    try {
    await processor.processDisc(disc);
      await progressLog.success(disc, directory);
    } catch (error) {
      console.error('******* ERROR:', error.toString());
      await progressLog.error(disc, directory);
    }

    console.log(total--, 'remaining');
  }

  console.log('All done!');
}

init();
