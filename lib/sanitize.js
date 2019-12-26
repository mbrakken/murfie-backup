const removeDiacritics = require('./removeDiacritics');

function cleanFile(filename) {
  while (filename.indexOf('.') === 0) {
    filename = filename.replace(/^\./, '');
  }

  // directory names cannot end in "." for windows systems
  while (filename[filename.length - 1] === '.') {
    filename = filename.replace(/\.$/, '');
  }

  return removeDiacritics(
    filename
      .substr(0, 240)
      .replace(/[\?\!<>\\\/\*\:\|\"“”‟\[\]]/g, '')
      .replace(/[‘’‛]/g, "'")
  );
}

module.exports = function sanatizeFile(filename) {
  return cleanFile(filename)
    .replace(/[^\d\s\w-_&]/g, '') // anything that isn't a number, letter, space, &, _, or -
    .trim();
};
