import test from 'node:test';
import assert from 'node:assert/strict';
import { db, get, run } from '../src/db.js';
import { verifyGoogleToken } from '../src/services/googleAuth.js';
import { hashPassword } from '../src/lib/crypto.js';
import config from '../src/config.js';

test('Google token verification edge cases', async (t) => {
  await t.test('rejects empty or invalid credential types', async () => {
    await assert.rejects(() => verifyGoogleToken(null), { status: 400 });
    await assert.rejects(() => verifyGoogleToken(''), { status: 400 });
    await assert.rejects(() => verifyGoogleToken(12345), { status: 400 });
  });

  await t.test('rejects expired Google tokens', async () => {
    await assert.rejects(
      () => verifyGoogleToken('test-google-token:sub-1:exp@test.com:Exp User:expired'),
      { status: 401, message: /expired/i }
    );
  });

  await t.test('rejects invalid signatures', async () => {
    await assert.rejects(
      () => verifyGoogleToken('test-google-token:sub-1:bad@test.com:Bad User:invalid_signature'),
      { status: 401, message: /signature/i }
    );
  });

  await t.test('rejects audience mismatch', async () => {
    await assert.rejects(
      () => verifyGoogleToken('test-google-token:sub-1:aud@test.com:Aud User:audience_mismatch'),
      { status: 401, message: /audience/i }
    );
  });

  await t.test('rejects unverified Google accounts', async () => {
    await assert.rejects(
      () => verifyGoogleToken('test-google-token:sub-1:unv@test.com:Unv User:unverified_email'),
      { status: 403, message: /verified/i }
    );
  });

  await t.test('parses valid token claims', async () => {
    const res = await verifyGoogleToken('test-google-token:sub-999:valid@athlete.com:Valid Athlete:valid');
    assert.equal(res.sub, 'sub-999');
    assert.equal(res.email, 'valid@athlete.com');
    assert.equal(res.name, 'Valid Athlete');
    assert.equal(res.email_verified, true);
  });

  await t.test('rejects simulated test tokens in production mode', async () => {
    config.isProd = true;
    try {
      await assert.rejects(
        () => verifyGoogleToken('test-google-token:sub-999:valid@athlete.com:Valid Athlete:valid'),
        { status: 403, message: /not permitted in production/i }
      );
    } finally {
      config.isProd = false;
    }
  });
});
