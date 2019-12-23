const { EOL } = require('os');
const prompts = require('prompts');
const argv = require('yargs').argv;

function handleQuit(state) {
  if (state.aborted) {
    console.log(`${EOL}${EOL}Quitting.${EOL}`);
    process.exit(1);
  }
}

module.exports.welcomeMsg = `
*** Murfie album downloader ***

Please note that this is not a full replacement for their download processing.
This can only download streamable tracks. If you were a HiFi customer, we can download FLAC,
but otherwise we're restricted to lossy formats (mp3, ogg).

*******************************

Enter your Murfie credentials:${EOL}`;

module.exports.getCredentials = async function getCredentials() {
  return await prompts([
    {
      type: 'text',
      name: 'email',
      message: 'Email address:',
      initial: argv.email,
      onState: handleQuit
    },
    {
      type: 'invisible',
      name: 'password',
      message: 'Password:',
      onState: handleQuit
    }
  ]);
};

module.exports.selectFormat = async function selectFormat(subscription) {
  const formatOptions = [
    { title: 'FLAC', value: 'flac' },
    { title: 'MP3', value: 'mp3' },
    { title: 'OGG', value: 'ogg' }
  ];

  const choices =
    subscription === 'hifi' ? formatOptions : formatOptions.slice(1);

  const { format } = await prompts({
    type: 'select',
    name: 'format',
    message: 'Select download format',
    choices,
    initial: 0
  });

  return format;
};
