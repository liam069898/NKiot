'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Shared by the POS and backup CLI; never guess a different database during backup.
function resolveDbPath(env = process.env, root = __dirname) {
    return path.resolve(
        env.NKIOT_DB_PATH ||
            env.MINIKIOT_DB_PATH ||
            path.join(root, fs.existsSync(path.join(root, 'nkiot.db')) ? 'nkiot.db' : 'minikiot.db')
    );
}

module.exports = { resolveDbPath };
