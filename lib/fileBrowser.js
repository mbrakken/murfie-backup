const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const prompts = require('prompts');

const { sep } = path;
const { EOL } = os;
const homeDir = os.homedir();

function handleQuit(state) {
  if (state.aborted) {
    console.log(`${EOL}${EOL}Quitting. Last value: ${state.value}${EOL}`);
    process.exit(1);
  }
}

const notHidden = c =>
  typeof c === 'string' ? c[0] !== '.' : c.name && c.name[0] !== '.';

async function getDirectories(dirPath) {
  dirPath = dirPath || homeDir;
  const contents = await fs.readdir(dirPath, { withFileTypes: true });

  return contents.filter(c => notHidden(c) && c.isDirectory()).map(d => d.name);
}

async function browse(dirPath) {
  dirPath = dirPath || homeDir;

  // clearing the screen, both with readline and console.clear(),
  // was causing a strange issue where there could be more than one set
  // of selections on the screen at a time, in addition to cases where
  // questions would be asked in rapid succession with no user input
  // await clearScreen();
  const directories = await getDirectories(dirPath);

  const questions = {
    type: 'select',
    name: 'folder',
    message: `Select a directory, currently in ${dirPath}`,
    choices: [
      {
        title: 'Up one level',
        value: '..',
        disabled: dirPath === '/'
      },
      {
        title: dirPath,
        value: '.',
        description: 'Current directory'
      }
    ].concat(directories.map(d => ({ title: '\t' + sep + d, value: d }))),
    initial: 1,
    onState: handleQuit
  };

  const { folder } = await prompts(questions);

  return await confirmDirectory(path.join(dirPath, folder));
}

async function confirmDirectory(directory) {
  const questions = {
    type: 'select',
    name: 'nextAction',
    message: `Use ${directory}?`,
    choices: [
      { title: `Continue browsing`, value: 'browse' },
      { title: `Use ${directory}`, value: 'proceed' }
    ],
    initial: 0,
    onState: handleQuit
  };

  const { nextAction } = await prompts(questions);

  if (nextAction === 'browse') {
    return await browse(directory);
  }

  return directory;
}

module.exports = browse;
