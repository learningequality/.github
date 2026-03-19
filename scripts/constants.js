// See docs/community-automations.md

const LE_BOT_USERNAME = 'learning-equality-bot[bot]';
const SENTRY_BOT_USERNAME = 'sentry-io[bot]';
const DEPENDABOT_USERNAME = 'dependabot[bot]';
const RTIBBLESBOT_USERNAME = 'rtibblesbot';
const BOT_USERNAMES = [
  LE_BOT_USERNAME,
  SENTRY_BOT_USERNAME,
  DEPENDABOT_USERNAME,
  RTIBBLESBOT_USERNAME,
];

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
  'Prashant-thakur77',
  'Sahil-Sinha-11',
  'shivam-daksh',
  'shruti862',
  'thesujai',
  'vtushar06',
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
const LABEL_COMMUNITY_REVIEW = 'community-review';

// Will be attached to bot messages when not empty
// const GSOC_NOTE = '';
const GSOC_NOTE = `\n\n**Are you preparing for Google Summer of Code? See our [GSoC guidelines.](https://learningequality.org/contributing-to-our-open-code-base/#google-summer-of-code)**`;

const BOT_MESSAGE_ISSUE_NOT_OPEN = `Hi! 👋 \n\n Thanks so much for your interest! **This issue is not open for contribution. Visit [Contributing guidelines](https://learningequality.org/contributing-to-our-open-code-base) to learn about the contributing process and how to find suitable issues. If there are no unassigned 'help wanted' issues available, please wait until new ones are added.** \n\n We really appreciate your willingness to help. 😊${GSOC_NOTE}`;

const BOT_MESSAGE_ALREADY_ASSIGNED = `Hi! 👋 \n\n Thanks so much for your interest! **This issue is already assigned. Visit [Contributing guidelines](https://learningequality.org/contributing-to-our-open-code-base) to learn about the contributing process and how to find suitable issues. If there are no unassigned 'help wanted' issues available, please wait until new ones are added.** \n\n We really appreciate your willingness to help. 😊${GSOC_NOTE}`;

const BOT_MESSAGE_PULL_REQUEST = (author) => `👋 Hi @${author}, thanks for contributing! \n\n **For the review process to begin, please verify that the following is satisfied:**\n\n- [ ] **Contribution is aligned with our [contributing guidelines](https://learningequality.org/contributing-to-our-open-code-base)**\n- [ ] **Pull request description has correctly filled _AI usage_ section & follows our AI guidance:**\n\n    <details>\n    <summary><b><i>AI guidance</i></b></summary>\n\n    <br>\n\n    **State explicitly whether you didn't use or used AI & how.**\n\n    If you used it, ensure that the PR is aligned with [Using AI](https://learningequality.org/contributing-to-our-open-code-base/#using-generative-ai) as well as our DEEP framework. DEEP asks you:\n\n    - **Disclose** — Be open about when you've used AI for support.\n    - **Engage critically** — Question what is generated. Review code for correctness and unnecessary complexity.\n    - **Edit** — Review and refine AI output. Remove unnecessary code and verify it still works after your edits.\n    - **Process sharing** — Explain how you used the AI so others can learn.\n\n    <br>\n\n    Examples of good disclosures:\n\n    > "I used Claude Code to implement the component, prompting it to follow the pattern in ComponentX. I reviewed the generated code, removed unnecessary error handling, and verified the tests pass."\n\n    > "I brainstormed the approach with Gemini, then had it write failing tests for the feature. After reviewing the tests, I used Claude Code to generate the implementation. I refactored the output to reduce verbosity and ran the full test suite."\n\n    </details>\n\nAlso check that issue requirements are satisfied & you ran \`pre-commit\` locally. \n\n**Pull requests that don't follow the guidelines will be closed.**\n\n**Reviewer assignment can take up to 2 weeks.**`;

const HOLIDAY_MESSAGE = `Season's greetings! 👋 \n\n We'd like to thank everyone for another year of fruitful collaborations, engaging discussions, and for the continued support of our work. **Learning Equality will be on holidays from December 22 to January 5.** We look forward to much more in the new year and wish you a very happy holiday season!${GSOC_NOTE}`;

const BOT_MESSAGE_RTIBBLESBOT_REVIEW = `📢✨ **Before we assign a reviewer, we'll turn on \`@rtibblesbot\` to pre-review. Its comments are generated by an LLM, and should be evaluated accordingly.**`;

const BOT_MESSAGE_COMMUNITY_REVIEW = `📢✨ **Before we assign a reviewer, we'll invite community pre-review. See the [community review guidance](https://github.com/learningequality/.github/blob/main/docs/community-review.md) for both authors and reviewers.**`;

// Repositories to include in PR statistics reports
const PR_STATS_REPOS = [
  'kolibri',
  'studio',
  'kolibri-design-system',
  'le-utils',
  '.github',
  'ricecooker',
];

// Repositories in which we accept open-source contributions
const COMMUNITY_REPOS = [...PR_STATS_REPOS];

module.exports = {
  LE_BOT_USERNAME,
  BOT_USERNAMES,
  CLOSE_CONTRIBUTORS,
  KEYWORDS_DETECT_ASSIGNMENT_REQUEST,
  ISSUE_LABEL_HELP_WANTED,
  BOT_MESSAGE_ISSUE_NOT_OPEN,
  BOT_MESSAGE_ALREADY_ASSIGNED,
  BOT_MESSAGE_PULL_REQUEST,
  BOT_MESSAGE_RTIBBLESBOT_REVIEW,
  RTIBBLESBOT_USERNAME,
  LABEL_COMMUNITY_REVIEW,
  BOT_MESSAGE_COMMUNITY_REVIEW,
  TEAMS_WITH_CLOSE_CONTRIBUTORS,
  HOLIDAY_MESSAGE,
  PR_STATS_REPOS,
  COMMUNITY_REPOS,
};
