# Murfie Backup

## Usage
* Instal git: https://git-scm.com/book/en/v2/Getting-Started-Installing-Git
* Install node: https://nodejs.org/en/download/ (I was running 12.14.0)
* From a terminal, clone the repo: 
```bash
git clone https://github.com/mbrakken/murfie-backup.git
```
* and enter the directory: 
```bash
cd murfie-backup
```bash
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
There will be some preamble and it will ask for your password. Then you will be prompted to navigate to the directory you want to download into. Upon confirming the directory it will create a directory called `MurfieBackup_flac` or `MurfieBackup_mp3` (if it doesn't exist in the selected location) and begin downloading into it. 

Currently it only supports mp3 and flac. It's unclear to me if FLAC works for people without HiFi.

Be aware of file system constraints on your drive and network constraints, eg. available disk space and any network download caps you may have. This won't pay any attention to them.

I've only tested this on a unix (osx) system, so while I've accommodate discrepencies across operating systems, I can't guarantee proper functionality.

No warranty is provided. Use and modify at your own risk.
