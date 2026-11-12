'use strict';
require('./test-env');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../db');
const vtpConfig = require('../viettelpost-config');

before(() => db.initDb());
after(() => db.closeDb());

test('viettelpost config encrypts secrets and publicStatus never exposes them', () => {
    vtpConfig.saveConfig({
        baseUrl: 'https://partner.viettelpost.vn',
        username: '0933177454',
        password: 'secret-password',
        webhookSecret: 'wh-secret'
    });
    const status = vtpConfig.publicStatus();
    assert.equal(status.configured, true);
    assert.equal(status.baseUrl, 'https://partner.viettelpost.vn');
    assert.equal(status.username, '0933177454');
    assert.ok(!JSON.stringify(status).includes('secret-password'));
    assert.ok(!JSON.stringify(status).includes('wh-secret'));

    const resolved = vtpConfig.getResolvedConfig();
    assert.equal(resolved.password, 'secret-password');
    assert.equal(resolved.webhookSecret, 'wh-secret');
});

test('viettelpost config keeps previous secrets when left blank', () => {
    vtpConfig.saveConfig({
        baseUrl: 'https://partnerdev.viettelpost.vn',
        username: 'u',
        password: 'p1'
    });
    vtpConfig.saveConfig({ baseUrl: 'https://partner.viettelpost.vn', username: 'u2' });
    const resolved = vtpConfig.getResolvedConfig();
    assert.equal(resolved.password, 'p1', 'mật khẩu cũ được giữ khi bỏ trống');
    assert.equal(resolved.username, 'u2');
});
