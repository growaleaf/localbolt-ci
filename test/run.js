'use strict';
// Standalone-package test suite for localbolt-ci. Exercises the exact exported functions the
// shipped cli.js ships (buildReport, verifyLicenseWith) — not a reimplementation.
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const { buildReport, verifyLicenseWith, flatten, parseYaml } = require('../cli.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL - ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

const fixtures = path.join(__dirname, 'fixtures', 'locales');

test('buildReport finds the real, known-missing keys in the fixture set', () => {
  const report = buildReport(fixtures, {});
  assert.strictEqual(report.baseLocale, 'en');
  assert.strictEqual(report.locales.de.missingKeys.length, 2);
  assert.deepStrictEqual(report.locales.de.missingKeys.sort(), ['checkout_confirm', 'payment_success']);
  assert.strictEqual(report.locales.es.missingKeys.length, 1);
  assert.deepStrictEqual(report.locales.es.missingKeys, ['payment_success']);
  assert.strictEqual(report.locales.fr.missingKeys.length, 0);
  assert.strictEqual(report.missing_count, 3);
});

test('flatten handles nested objects with dotted paths', () => {
  const out = flatten({ a: { b: 'x', c: { d: 'y' } } }, '', {});
  assert.deepStrictEqual(out, { 'a.b': 'x', 'a.c.d': 'y' });
});

test('parseYaml reads a simple mapping', () => {
  const obj = parseYaml('welcome: Hello\ncart: Cart\n', 'test.yaml');
  assert.deepStrictEqual(obj, { welcome: 'Hello', cart: 'Cart' });
});

test('license: a key signed by the real private key verifies true against the matching public key', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const payload = Buffer.from(JSON.stringify({ product: 'localbolt-pro', iat: Date.now() })).toString('base64url');
  const sig = crypto.createSign('SHA256').update(`LB1.${payload}`).end().sign(privateKey).toString('base64url');
  const key = `LB1.${payload}.${sig}`;
  assert.strictEqual(verifyLicenseWith(key, pubPem), true);
});

test('license: a tampered key is rejected', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const payload = Buffer.from(JSON.stringify({ product: 'localbolt-pro', iat: Date.now() })).toString('base64url');
  const sig = crypto.createSign('SHA256').update(`LB1.${payload}`).end().sign(privateKey).toString('base64url');
  const tamperedPayload = Buffer.from(JSON.stringify({ product: 'localbolt-pro', iat: 0 })).toString('base64url');
  const key = `LB1.${tamperedPayload}.${sig}`;
  assert.strictEqual(verifyLicenseWith(key, pubPem), false);
});

test('license: a key signed by a DIFFERENT private key is rejected by this public key', () => {
  const { publicKey: pubA } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { privateKey: privB } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pubPemA = pubA.export({ type: 'spki', format: 'pem' });
  const payload = Buffer.from(JSON.stringify({ product: 'localbolt-pro', iat: Date.now() })).toString('base64url');
  const sig = crypto.createSign('SHA256').update(`LB1.${payload}`).end().sign(privB).toString('base64url');
  const key = `LB1.${payload}.${sig}`;
  assert.strictEqual(verifyLicenseWith(key, pubPemA), false);
});

console.log(`\n${passed} passed, ${process.exitCode ? 'some failed' : '0 failed'}`);
if (!process.exitCode) console.log('All localbolt-ci standalone test groups passed.');
