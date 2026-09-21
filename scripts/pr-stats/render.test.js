const test = require('node:test');
const assert = require('node:assert/strict');

const { sparkline, histogram, percentile, formatDuration, formatMedianCount } = require('./render');

test('sparkline: all-equal values map to the middle-height bar', () => {
  assert.equal(sparkline([2, 2, 2]), '▄▄▄');
});

test('sparkline: min and max map to the lowest and highest bars', () => {
  assert.equal(sparkline([0, 7]), '▁█');
});

test('histogram: uses logarithmic binning, not linear', () => {
  const bins = histogram([1, 1, 1000], 4);
  assert.deepEqual(bins, [2, 0, 0, 1]);
});

test('percentile: interpolates between ranks rather than nearest-rank', () => {
  assert.equal(percentile([0, 10], 50), 5);
});

test('formatDuration: formats seconds, hours+minutes, and exact days', () => {
  assert.equal(formatDuration(30000), '<1m');
  assert.equal(formatDuration(7500000), '2h 5m');
  assert.equal(formatDuration(86400000), '1d');
});

test('formatMedianCount: prints a whole number bare, with no decimal point', () => {
  assert.equal(formatMedianCount(2), '2');
});

test('formatMedianCount: prints a fractional value to one decimal place', () => {
  assert.equal(formatMedianCount(1.5), '1.5');
  assert.equal(formatMedianCount(1.500000000001), '1.5');
});
