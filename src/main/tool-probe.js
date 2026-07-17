'use strict';

const fs = require('node:fs');
const path = require('node:path');

function executableOnPath(command, env = process.env) {
  const directories = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  return directories.some((directory) => {
    try {
      fs.accessSync(path.join(directory, command), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function probeTools(tools, env = process.env) {
  return Object.fromEntries(tools.map((tool) => [tool, executableOnPath(tool, env)]));
}

module.exports = { executableOnPath, probeTools };
