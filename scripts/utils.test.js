const test = require('node:test');
const assert = require('node:assert/strict');

const { escapeIssueTitleForSlackMessage, findIssueReferences } = require('./utils');

const references = body => findIssueReferences(body, 'learningequality', 'kolibri');

test('every reference form names an issue in the same repository', () => {
  const body = [
    'See #1.',
    'Also learningequality/kolibri#2,',
    'https://github.com/learningequality/kolibri/issues/3 and',
    '[the issue](https://github.com/LearningEquality/Kolibri/issues/4)',
  ].join('\n');

  assert.deepEqual(
    references(body).map(r => r.number),
    [1, 2, 3, 4],
  );
});

test('a reference to another repository is ignored', () => {
  const body = 'learningequality/studio#5 and https://github.com/learningequality/studio/issues/6';

  assert.deepEqual(references(body), []);
});

test('a reference in code or a comment is ignored', () => {
  const body = [
    'Use `#1` here.',
    '```',
    'Fixes #2',
    '```',
    '<!-- for example Fixes #3 -->',
    '~~~js',
    '#4',
    '~~~',
  ].join('\n');

  assert.deepEqual(references(body), []);
});

test('a hash inside a word, an entity or an anchor is not a reference', () => {
  const body = 'issue#1 &#2; https://github.com/learningequality/kolibri/pull/3#issuecomment-4';

  assert.deepEqual(references(body), []);
});

test('a closing keyword marks the reference', () => {
  const body = 'Fixes #1, closes: #2, Resolved [#3](url), see #4';

  assert.deepEqual(references(body), [
    { number: 1, keyword: true },
    { number: 2, keyword: true },
    { number: 3, keyword: true },
    { number: 4, keyword: false },
  ]);
});

test('a repeated reference appears once, closing if any mention closes it', () => {
  assert.deepEqual(references('See #7. Fixes #7'), [{ number: 7, keyword: true }]);
});

test('a number too large to be an issue is ignored', () => {
  assert.deepEqual(references('#2147483648 and #2147483647'), [
    { number: 2147483647, keyword: false },
  ]);
});

test('an empty description has no references', () => {
  assert.deepEqual(references(null), []);
});

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
