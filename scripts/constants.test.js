const constants = require('./constants');

describe('assign-related constants', () => {
  test('ISSUE_LABEL_GOOD_FIRST_ISSUE is defined', () => {
    expect(constants.ISSUE_LABEL_GOOD_FIRST_ISSUE).toBe('good first issue');
  });

  test('MAX_ASSIGNED_ISSUES is 2', () => {
    expect(constants.MAX_ASSIGNED_ISSUES).toBe(2);
  });

  test('COOLDOWN_DAYS is 7', () => {
    expect(constants.COOLDOWN_DAYS).toBe(7);
  });

  test('ASSIGN_GUIDANCE_MARKER is an HTML comment marker', () => {
    expect(constants.ASSIGN_GUIDANCE_MARKER).toBe('<!-- ASSIGN_GUIDANCE -->');
  });

  test('GSOC_NOTE is exported', () => {
    expect(constants.GSOC_NOTE).toBeDefined();
    expect(typeof constants.GSOC_NOTE).toBe('string');
  });
});

describe('bot messages for /assign', () => {
  test('BOT_MESSAGE_GOOD_FIRST_ISSUE_GUIDANCE contains marker and key info', () => {
    const msg = constants.BOT_MESSAGE_GOOD_FIRST_ISSUE_GUIDANCE;
    expect(msg).toBeDefined();
    expect(msg).toContain(constants.ASSIGN_GUIDANCE_MARKER);
    expect(msg).toContain('/assign');
    expect(msg).toContain('self-assignment');
    expect(msg).toContain(String(constants.MAX_ASSIGNED_ISSUES));
    expect(msg).toContain(String(constants.COOLDOWN_DAYS));
    expect(msg).toContain('Contributing guidelines');
  });

  test('BOT_MESSAGE_ASSIGN_SUCCESS contains assignment confirmation', () => {
    const msg = constants.BOT_MESSAGE_ASSIGN_SUCCESS;
    expect(msg).toBeDefined();
    expect(msg).toContain('assigned');
    expect(msg).toContain('Link your pull request');
  });

  test('BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE explains GFI requirement', () => {
    const msg = constants.BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE;
    expect(msg).toBeDefined();
    expect(msg).toContain('good first issue');
    expect(msg).toContain('/assign');
  });

  test('BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE guides to /assign', () => {
    const msg = constants.BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE;
    expect(msg).toBeDefined();
    expect(msg).toContain('/assign');
    expect(msg).toContain('self-assignment');
  });

  test('all new bot messages include GSOC_NOTE', () => {
    const gsoc = constants.GSOC_NOTE;
    expect(constants.BOT_MESSAGE_GOOD_FIRST_ISSUE_GUIDANCE).toContain(gsoc);
    expect(constants.BOT_MESSAGE_ASSIGN_SUCCESS).toContain(gsoc);
    expect(constants.BOT_MESSAGE_ASSIGN_NOT_GOOD_FIRST_ISSUE).toContain(gsoc);
    expect(constants.BOT_MESSAGE_KEYWORD_GOOD_FIRST_ISSUE).toContain(gsoc);
  });
});
