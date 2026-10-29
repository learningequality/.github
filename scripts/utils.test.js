const test = require('node:test');
const assert = require('node:assert/strict');

const { escapeIssueTitleForSlackMessage } = require('./utils');

function payload(title) {
  return `{\n  "text": "on issue: <url|${escapeIssueTitleForSlackMessage(title)}>"\n}`;
}

function rendered(title) {
  return JSON.parse(payload(title)).text;
}

test('a plain title passes through', () => {
  assert.equal(rendered('Migrate the device tests'), 'on issue: <url|Migrate the device tests>');
});

test('a backslash survives as one backslash', () => {
  assert.equal(rendered('Fix C:\\path handling'), 'on issue: <url|Fix C:\\path handling>');
});

test('a quote survives as one quote', () => {
  assert.equal(rendered('Quote " in title'), 'on issue: <url|Quote " in title>');
});

test('a backslash before a quote survives both', () => {
  assert.equal(rendered('Odd \\" title'), 'on issue: <url|Odd \\" title>');
});

test('angle brackets cannot end the Slack link early', () => {
  const text = rendered('Fix <ChannelList> rendering');
  assert.equal(text, 'on issue: <url|Fix &lt;ChannelList&gt; rendering>');
  assert.equal(text.match(/>/g).length, 1);
});

for (const title of [
  'Fix C:\\path handling',
  'Quote " in title',
  'Both \\ and " and <tag>',
  'Trailing backslash \\',
]) {
  test(`the payload stays valid JSON for ${JSON.stringify(title)}`, () => {
    assert.doesNotThrow(() => JSON.parse(payload(title)));
  });
}
