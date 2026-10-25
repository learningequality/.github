# Setting up a development environment

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), Node.js 20 and
[Yarn 1](https://classic.yarnpkg.com/en/docs/install). The `actionlint` hook also needs
[shellcheck](https://github.com/koalaman/shellcheck#installing) on your `PATH`.

Install the Python and JS dependencies:

```bash
uv sync --group dev
yarn install --frozen-lockfile
```

Install the prek git hook, so the checks run on every commit:

```bash
uv run prek install
```

Run every hook against the whole repo, as CI does:

```bash
uv run prek run --all-files
```

Run the JS tests with `yarn test`.
