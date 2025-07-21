const LE_BOT_USERNAME = 'learningequality[bot]';
const CLOSE_CONTRIBUTORS = ['user1', 'user2'];

const KEYWORDS_DETECT_ASSIGNMENT_REQUEST = [
  'assign', 'assigned',
  'work', 'working',
  'contribute', 'contributing',
  'request', 'requested',
  'pick', 'picked', 'picking',
  'address', 'addressing',
  'handle', 'handling',
  'solve', 'solving', 'resolve', 'resolving',
  'try', 'trying',
  'grab', 'grabbing',
  'claim', 'claimed',
  'interest', 'interested',
  'do', 'doing',
  'help',
  'take',
  'want',
  'would like',
  'own',
  'on it',
  'available',
  'got this'
];

const ISSUE_LABEL_HELP_WANTED = 'help wanted';

const BOT_MESSAGE_ISSUE_NOT_OPEN = `Hi! 👋 \n\n Thanks so much for your interest! **This issue is not open for contribution. Visit [Contributing guidelines](https://learningequality.org/contributing-to-our-open-code-base) to learn about the contributing process and how to find suitable issues.** \n\n We really appreciate your willingness to help—you're welcome to find a more suitable issue, and let us know if you have any questions. 😊`;

module.exports = {
  LE_BOT_USERNAME,
  CLOSE_CONTRIBUTORS,
  KEYWORDS_DETECT_ASSIGNMENT_REQUEST,
  ISSUE_LABEL_HELP_WANTED,
  BOT_MESSAGE_ISSUE_NOT_OPEN,
};
