var ERROR = 2;

module.exports = {
  env: {
    es6: true,
    browser: true,
    node: true,
  },
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2020,
    ecmaFeatures: {
      impliedStrict: true,
    },
  },
  extends: ['eslint:recommended'],
  rules: {
    'comma-style': ERROR,
    'no-console': ERROR,
    'max-len': [
      ERROR,
      100,
      {
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
        ignoreUrls: true,
        ignoreTrailingComments: true,
      },
    ],
  },
};
