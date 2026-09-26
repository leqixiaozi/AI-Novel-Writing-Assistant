const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveModelCredentialKey, sealModelCredential, openModelCredential } = require('../dist/server/database/credentialCrypto');

test('model credential ciphertext round-trips without exposing the original key', () => {
  const key = deriveModelCredentialKey('fixture-database-password', 'fixture_database');
  const first = sealModelCredential('fixture-api-key-123', key);
  const second = sealModelCredential('fixture-api-key-123', key);
  assert.notDeepEqual(first, second);
  assert.equal(first.includes(Buffer.from('fixture-api-key-123')), false);
  assert.equal(openModelCredential(first, key), 'fixture-api-key-123');
  assert.throws(() => openModelCredential(first, deriveModelCredentialKey('wrong-password', 'fixture_database')));
  assert.throws(() => openModelCredential(Buffer.from([99]), key));
});
