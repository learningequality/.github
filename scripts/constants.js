// See docs/community-automations.md

const LE_BOT_USERNAME = 'learning-equality-bot[bot]';
const SENTRY_BOT_USERNAME = 'sentry-io[bot]';

// close contributors are treated a bit special in some workflows,
// for example, we receive a high priority notification about their
// comments on all issues rather than just on 'help wanted' issues
const CLOSE_CONTRIBUTORS = [
  'AadarshM07',
  'Abhishek-Punhani',
  'BabyElias',
  'Dimi20cen',
  'EshaanAgg',
  'GarvitSinghal47',
  'habibayman',
  'iamshobhraj',
  'indirectlylit',
  'Jakoma02',
  'KshitijThareja',
  'muditchoudhary',
  'nathanaelg16',
  'nikkuAg',
  'Sahil-Sinha-11',
  'shivam-daksh',
  'shruti862',
  'thesujai',
  'WinnyChang',
  'yeshwanth235',
];

const TEAMS_WITH_CLOSE_CONTRIBUTORS = ['gsoc-contributors', 'learning-equality-community-guide'];

const KEYWORDS_DETECT_ASSIGNMENT_REQUEST = [
  'assign',
  'assigned',
  'work',
  'working',
  'contribute',
  'contributing',
  'request',
  'requested',
  'pick',
  'picked',
  'picking',
  'address',
  'addressing',
  'handle',
  'handling',
  'solve',
  'solving',
  'resolve',
  'resolving',
  'try',
  'trying',
  'grab',
  'grabbing',
  'claim',
  'claimed',
  'interest',
  'interested',
  'do',
  'doing',
  'help',
  'take',
  'want',
  'would like',
  'own',
  'on it',
  'available',
  'got this',
];

const ISSUE_LABEL_HELP_WANTED = 'help wanted';

// Will be attached to bot messages when not empty
// const GSOC_NOTE = '';
const GSOC_NOTE = `\n\n_Are you preparing for Google Summer of Code? See our [GSoC guidelines.](https://learningequality.org/contributing-to-our-open-code-base/#google-summer-of-code)._`;

const BOT_MESSAGE_ISSUE_NOT_OPEN = `Hi! 👋 \n\n Thanks so much for your interest! **This issue is not open for contribution. Visit [Contributing guidelines](https://learningequality.org/contributing-to-our-open-code-base) to learn about the contributing process and how to find suitable issues.** \n\n We really appreciate your willingness to help—you're welcome to find a more suitable issue, and let us know if you have any questions. 😊${GSOC_NOTE}`;

const BOT_MESSAGE_ALREADY_ASSIGNED = `Hi! 👋 \n\n Thanks so much for your interest! **This issue is already assigned. Visit [Contributing guidelines](https://learningequality.org/contributing-to-our-open-code-base) to learn about the contributing process and how to find suitable issues.** \n\n We really appreciate your willingness to help—you're welcome to find a more suitable issue, and let us know if you have any questions. 😊`;

const BOT_MESSAGE_PULL_REQUEST = `👋 Thanks for contributing! \n\n We will assign a reviewer within the next two weeks. In the meantime, please ensure that:\n\n- [ ] **You ran \`pre-commit\` locally**\n- [ ] **All issue requirements are satisfied**\n- [ ] **The contribution is aligned with our [Contributing guidelines](https://learningequality.org/contributing-to-our-open-code-base). Pay extra attention to [Using generative AI](https://learningequality.org/contributing-to-our-open-code-base/#using-generative-ai). Pull requests that don't follow the guidelines will be closed.**\n\nWe'll be in touch! 😊`;

const HOLIDAY_MESSAGE = `Season’s greetings! 👋 \n\n We’d like to thank everyone for another year of fruitful collaborations, engaging discussions, and for the continued support of our work. **Learning Equality will be on holidays from December 22 to January 5.** We look forward to much more in the new year and wish you a very happy holiday season!${GSOC_NOTE}`;

module.exports = {
  LE_BOT_USERNAME,
  SENTRY_BOT_USERNAME,
  CLOSE_CONTRIBUTORS,
  KEYWORDS_DETECT_ASSIGNMENT_REQUEST,
  ISSUE_LABEL_HELP_WANTED,
  BOT_MESSAGE_ISSUE_NOT_OPEN,
  BOT_MESSAGE_ALREADY_ASSIGNED,
  BOT_MESSAGE_PULL_REQUEST,
  TEAMS_WITH_CLOSE_CONTRIBUTORS,
  HOLIDAY_MESSAGE,
};
