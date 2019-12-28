const fs = require('fs').promises;
const path = require('path');
const { EOL } = require('os');

const PROGRESS_LOG = 'dl_progress';
const ERROR_LOG = 'dl_errors';

function success(item, directory) {
  const { id } = item.disc;
  const filePath = path.join(directory, PROGRESS_LOG);
  return fs.writeFile(filePath, id);
}

function error(item, directory) {
  const { album, id} = item.disc;
  const filePath = path.join(directory, ERROR_LOG);

  return fs.appendFile(filePath, `${id}\t${album.title}\t${album.main_artist}${EOL}`);
}

async function lastDisc(directory) {
  const logPath = path.join(directory, PROGRESS_LOG);

  try {
    return await fs.readFile(logPath, 'utf8');
  } catch(e) {
    return null;
  }
}

module.exports = {
  success,
  error,
  lastDisc
};
