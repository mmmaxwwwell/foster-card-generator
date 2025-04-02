const tmp = require('tmp');
const fs = require('fs').promises;
const rimraf = require('rimraf');
const path = require('path');

async function createTempDir() {
  return new Promise((resolve, reject) => {
    tmp.dir({ prefix: 'foster-card-', tmpdir: '/tmp' }, (err, tmpPath, cleanupCallback) => {
      if (err) {
        reject(err);
      } else {
        resolve({ path: tmpPath, cleanup: () => new Promise(res => rimraf(tmpPath, res)) });
      }
    });
  });
}

module.exports = createTempDir;
