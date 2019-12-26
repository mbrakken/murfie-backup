const fs = require('fs').promises;
const path = require('path');

module.exports = async function createDirectory(pathName) {
  const dirName = path.basename(pathName);

  // console.log(`Checking for a directory named ${dirName}`);

  try {
    await fs.mkdir(pathName);
    // console.log('created directory', dirName);
  } catch (error) {
    if (error.code === 'EEXIST') {
      // console.log(dirName, 'already exists');
    } else {
      console.error('UNEXPECTED ERROR', error.type);
      console.error(error);
      throw error;
    }
  }

  return;
};
