/**
 * The "Recover your company link" form checks. Display-side only; the server is the authority.
 * Runs with Node's own test runner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UNVERIFIED_MESSAGE, emailError, recoveryFailureMessage, validateRecovery } from '../src/utils/recoveryForm.ts';

const valid = { companyName: 'Acme Health', password: 'x' };

describe('validateRecovery', () => {
  it('accepts a complete form', () => {
    assert.deepEqual(validateRecovery(valid), {});
  });

  it('requires the company name and password, and nothing else', () => {
    const errors = validateRecovery({ companyName: '', password: '' });
    assert.deepEqual(Object.keys(errors).sort(), ['companyName', 'password']);
  });

  it('treats a name of only spaces as missing, and accepts edge spaces and any case', () => {
    assert.ok(validateRecovery({ ...valid, companyName: '   ' }).companyName);
    assert.deepEqual(validateRecovery({ ...valid, companyName: '  aCME health ' }), {});
  });

  it('rejects names longer than the server accepts', () => {
    assert.ok(validateRecovery({ ...valid, companyName: 'x'.repeat(121) }).companyName);
    assert.deepEqual(validateRecovery({ ...valid, companyName: 'x'.repeat(120) }), {});
  });

  it('does not judge the password beyond being present (the server decides)', () => {
    assert.deepEqual(validateRecovery({ ...valid, password: ' ' }), {});
    assert.ok(validateRecovery({ ...valid, password: '' }).password);
  });
});

describe('emailError (the "email me my link" option)', () => {
  it('rejects malformed emails and accepts edge spaces and any case', () => {
    for (const email of ['', 'alex', 'alex@', '@acme.com', 'alex@acme', 'alex acme@x.com', 'a@b@c.com']) {
      assert.ok(emailError(email), email);
    }
    assert.equal(emailError('  Alex@Acme.com.au '), undefined);
  });
});

describe('recoveryFailureMessage', () => {
  it('gives the same generic message for every rejected detail', () => {
    assert.equal(recoveryFailureMessage(401), UNVERIFIED_MESSAGE);
    assert.equal(recoveryFailureMessage(400), UNVERIFIED_MESSAGE);
    assert.equal(recoveryFailureMessage(404), UNVERIFIED_MESSAGE);
    // Says neither that the company exists nor which of the two was wrong.
    assert.doesNotMatch(UNVERIFIED_MESSAGE, /doesn.t exist|no such|not found|not set/i);
    assert.match(UNVERIFIED_MESSAGE, /Company name or recovery password/);
  });

  it('distinguishes only things that say nothing about companies: rate limits, outages, no connection', () => {
    assert.match(recoveryFailureMessage(429, 'Too many attempts. Please wait a while before trying again.'), /Too many attempts/);
    assert.match(recoveryFailureMessage(503), /Try again in a moment/);
    assert.match(recoveryFailureMessage(undefined), /Can.t reach SimpleHours/);
  });
});
