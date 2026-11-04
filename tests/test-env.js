'use strict';
// Load before application modules, even when a single test file is run directly.
// Never inherit an operational database, upload directory, or Hub credentials.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nkiot-test-env-'));
process.env.NKIOT_DB_PATH = process.env.MINIKIOT_DB_PATH = path.join(root, 'test.db');
process.env.NKIOT_HUB_DB_PATH = path.join(root, 'hub.db');
process.env.NKIOT_HUB_MEDIA_DIR = path.join(root, 'hub-media');
process.env.NKIOT_UPLOADS_DIR = path.join(root, 'uploads');
process.env.NKIOT_LOCAL_DATA_DIR = path.join(root, 'admin');
delete process.env.NKIOT_HUB_URL;
delete process.env.NKIOT_HUB_API_KEY;
delete process.env.NKIOT_LOCAL_HUB_URL;
delete process.env.NKIOT_DEPLAO_URL;
delete process.env.NKIOT_DEPLAO_KEY;
delete process.env.NKIOT_DEPLAO_ACCOUNTS;
process.env.MINIKIOT_ADMIN_PASSWORD = 'Test-password-123';
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
