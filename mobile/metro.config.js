const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The plant engine and data types live in the web app; both apps run the same code.
config.watchFolders = [path.resolve(__dirname, '../web/src')];

module.exports = config;
