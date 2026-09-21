import { strict as assert } from 'node:assert';
import test from 'node:test';
import { formatClockTyping, normalizeClockInput } from './time-input.js';

test('formats four time digits as HH:MM', () => {
  assert.equal(normalizeClockInput('0831'), '08:31');
});

test('pads a single hour before the minute digits', () => {
  assert.equal(normalizeClockInput('831'), '08:31');
});

test('keeps the hour while the minute is being typed', () => {
  assert.equal(normalizeClockInput('083'), '08:3');
});

test('keeps a clear field clear', () => {
  assert.equal(normalizeClockInput(''), '');
});

test('does not corrupt a normal two-digit hour while typing', () => {
  assert.equal(formatClockTyping('1'), '1');
  assert.equal(formatClockTyping('14'), '14');
  assert.equal(formatClockTyping('143'), '14:3');
  assert.equal(formatClockTyping('14:30'), '14:30');
});

test('lets a keypad shorthand become 08:31 character by character', () => {
  assert.equal(formatClockTyping('8'), '8');
  assert.equal(formatClockTyping('83'), '08:3');
  assert.equal(formatClockTyping('08:31'), '08:31');
});

test('keeps an unfinished normal hour invalid instead of changing it', () => {
  assert.equal(formatClockTyping('14:3'), '14:3');
});
