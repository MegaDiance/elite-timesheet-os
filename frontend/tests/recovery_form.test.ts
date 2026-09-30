/**
 * The "Recover your login link" form checks. Display-side only; the server is the authority.
 * Runs with Node's own test runner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UNVERIFIED_MESSAGE, recoveryFailureMessage, validateRecovery } from '../src/utils/recoveryForm.ts';

const valid = { organisationName: 'Acme Construction Pty Ltd', email: 'owner@acme.com.au', password: 'x' };

describe('validateRecovery', () => {
  it('accepts a complete form', () => {
    assert.deepEqual(validateRecovery(valid), {});
  });

  it('requires the organisation name, owner email and password', () => {
    const errors = validateRecovery({ organisationName: '', email: '', password: '' });
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'organisationName', 'password']);
  });

  it('treats a name of only spaces as missing, and does not change the case or spacing it accepts', () => {
    assert.ok(validateRecovery({ ...valid, organisationName: '    ' }).organisationName);
    assert.deepEqual(validateRecovery({ ...valid, organisationName: '  ACME construction PTY ltd ' }), {});
  });

  it('rejects an overlong organisation name', () => {
    assert.ok(validateRecovery({ ...valid, organisationName: 'a'.repeat(121) }).organisationName);
    assert.deepEqual(validateRecovery({ ...valid, organisationName: 'a'.repeat(120) }), {});
  });

  it('rejects malformed emails', () => {
    for (const email of ['owner', 'owner@', '@acme.com', 'owner@acme', 'owner acme@x.com', 'a@b@c.com']) {
      assert.ok(validateRecovery({ ...valid, email }).email, email);
    }
    assert.deepEqual(validateRecovery({ ...valid, email: '  Owner@Acme.com.au ' }), {});
  });

  it('does not judge the password beyond being present (the server decides)', () => {
    assert.deepEqual(validateRecovery({ ...valid, password: ' ' }), {});
    assert.ok(validateRecovery({ ...valid, password: '' }).password);
  });
});

describe('recoveryFailureMessage', () => {
  it('gives the same generic message for every rejected detail', () => {
    assert.equal(recoveryFailureMessage(401), UNVERIFIED_MESSAGE);
    assert.equal(recoveryFailureMessage(400), UNVERIFIED_MESSAGE);
    assert.equal(recoveryFailureMessage(404), UNVERIFIED_MESSAGE);
    assert.match(UNVERIFIED_MESSAGE, /could not be verified/);
    assert.doesNotMatch(UNVERIFIED_MESSAGE, /doesn.t exist|not the owner|incorrect password|no such/i);
  });

  it('distinguishes only things that say nothing about the accounts: rate limits, outages, no connection', () => {
    assert.match(recoveryFailureMessage(429, 'Too many attempts. Please wait a while before trying again.'), /Too many attempts/);
    assert.match(recoveryFailureMessage(503), /try again in a moment/);
    assert.match(recoveryFailureMessage(undefined), /couldn.t reach SimpleHours/);
  });
});
