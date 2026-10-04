/**
 * The "Find your login link" form checks. Display-side only; the server is the authority.
 * Runs with Node's own test runner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UNVERIFIED_MESSAGE, emailError, recoveryFailureMessage, validateRecovery } from '../src/utils/recoveryForm.ts';

const valid = { email: 'alex@acme.com.au', password: 'x' };

describe('validateRecovery', () => {
  it('accepts a complete form', () => {
    assert.deepEqual(validateRecovery(valid), {});
  });

  it('requires the email and password, and nothing else', () => {
    const errors = validateRecovery({ email: '', password: '' });
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'password']);
  });

  it('rejects malformed emails and accepts edge spaces and any case', () => {
    for (const email of ['alex', 'alex@', '@acme.com', 'alex@acme', 'alex acme@x.com', 'a@b@c.com']) {
      assert.ok(validateRecovery({ ...valid, email }).email, email);
      assert.ok(emailError(email), email);
    }
    assert.deepEqual(validateRecovery({ ...valid, email: '  Alex@Acme.com.au ' }), {});
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
    assert.doesNotMatch(UNVERIFIED_MESSAGE, /doesn.t exist|incorrect password|no such|not found/i);
  });

  it('distinguishes only things that say nothing about the accounts: rate limits, outages, no connection', () => {
    assert.match(recoveryFailureMessage(429, 'Too many attempts. Please wait a while before trying again.'), /Too many attempts/);
    assert.match(recoveryFailureMessage(503), /try again in a moment/);
    assert.match(recoveryFailureMessage(undefined), /couldn.t reach SimpleHours/);
  });
});
