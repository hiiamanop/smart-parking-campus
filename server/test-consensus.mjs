import assert from 'node:assert/strict';
import { consensusPlate, isValidIdPlate, normalizePlateValue } from './plateConsensus.mjs';

// Normalization
assert.equal(normalizePlateValue('b 1234 abc'), 'B1234ABC');
assert.ok(isValidIdPlate('B 1234 ABC'));
assert.ok(isValidIdPlate('D1234AB'));
assert.ok(!isValidIdPlate('1234'));
assert.ok(!isValidIdPlate('B 12345 ABC'));

// Clear majority across three frames
const majority = consensusPlate([
  { plate: 'B 1234 ABC', confidence: 0.9 },
  { plate: 'B1234ABC', confidence: 0.8 },
  { plate: 'B 1234 ABD', confidence: 0.7 },
]);
assert.equal(majority.plate, 'B1234ABC');
assert.equal(majority.votes, 2);
assert.equal(majority.accepted, true);

// All frames disagree -> not accepted, candidates exposed
const split = consensusPlate([
  { plate: 'B 1234 ABC', confidence: 0.5 },
  { plate: 'D 5678 EFG', confidence: 0.5 },
]);
assert.equal(split.accepted, false);
assert.ok(split.candidates.length >= 2);

// Single strong reading is accepted
assert.equal(consensusPlate([{ plate: 'B 1234 ABC', confidence: 0.9 }]).accepted, true);

// Single weak reading is rejected
assert.equal(consensusPlate([{ plate: 'B 1234 ABC', confidence: 0.4 }]).accepted, false);

// Unreadable frames
const empty = consensusPlate([{ plate: null }, { plate: null }]);
assert.equal(empty.plate, null);
assert.equal(empty.accepted, false);

// Invalid plate shape never auto-accepted even with agreement
const invalid = consensusPlate([
  { plate: '1234567', confidence: 0.9 },
  { plate: '1234567', confidence: 0.9 },
]);
assert.equal(invalid.accepted, false);

// Character-level merge recovers a plate when frames differ by one character
const merged = consensusPlate([
  { plate: 'B 1234 ABC', confidence: 0.6 },
  { plate: 'B 1234 ABD', confidence: 0.6 },
  { plate: 'B 1234 XBC', confidence: 0.6 },
]);
assert.equal(merged.plate, 'B1234ABC');
assert.equal(merged.accepted, false);
assert.match(merged.reason, /gabungan/i);

console.log('Plate consensus assertions passed.');
