# Mrf Backup

## Usage
* Install node (I was running 12.13.1)
* Clone the repo and enter the directory
* Install dependencies:
```bash
npm install
```
* Run the script, optionally passing in a `--email` parameter eg:
```bash
node index.js
```
or
```
node index.js --email=your.email@example.com
```
There will be some preamble and it will ask for your password. Then you will be prompted to navigate to the directory you want to download into. Upon confirming the directory it will create a directory called `MurfieBackup_flac` or `MurfieBackup_mp3` and begin downloading into it. 

Currently it only supports mp3 and, if you had a HiFi account with lossless streaming enabled on sonos, flac. It's possible that flac could work for anyone without HiFi, but I can't test that.

Be aware of file system constraints on your drive and network constraints, eg. available disk space and any network download caps you may have. This won't pay any attention to them.

I've only tested this on a unix (osx) system, so while I've accommodate discrepencies across operating systems, I can't guarantee proper functionality.

No warranty is provided. Use and modify at your own risk.
