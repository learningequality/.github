/**
 * Shared test helper factories for mock GitHub Actions objects.
 */

function mockCore() {
  const outputs = {};
  return {
    info: jest.fn(),
    warning: jest.fn(),
    setFailed: jest.fn(),
    setOutput: jest.fn((key, val) => {
      outputs[key] = val;
    }),
    _outputs: outputs,
  };
}

module.exports = { mockCore };
