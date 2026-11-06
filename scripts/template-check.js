const { LE_BOT_USERNAME } = require('./constants');

const HEADING = /^(#{2,3}) [^#]/;
const REQUIRED_MARKER = /^\s*<!--\s*REQUIRED\s*-->\s*$/;
const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const PLACEHOLDER = '…';

function headingKey(heading) {
  return heading.replace(/^#+\s*/, '').toLowerCase();
}

function sections(markdown) {
  const lines = (markdown || '').split(/\r?\n/);
  const headings = [];
  lines.forEach((line, index) => {
    const match = HEADING.exec(line);
    if (match) headings.push({ heading: line.trim(), level: match[1].length, index });
  });
  return headings.map(({ heading, level, index }, i) => {
    const end = headings.slice(i + 1).find(next => next.level <= level);
    return { heading, level, lines: lines.slice(index + 1, end ? end.index : lines.length) };
  });
}

function isMarked(section) {
  const first = section.lines.find(line => line.trim() !== '');
  return first !== undefined && REQUIRED_MARKER.test(first);
}

// A template that marks nothing requires every top-level section, so a repo
// whose template has no markers is strict rather than unchecked.
function requiredSections(template) {
  const all = sections(template);
  const marked = all.filter(isMarked);
  return marked.length ? marked : all.filter(section => section.level === 2);
}

function content(section) {
  return section.lines.join('\n').replace(HTML_COMMENT, '').trim();
}

function failures(body, required) {
  const found = new Map(sections(body).map(section => [headingKey(section.heading), section]));
  const problems = [];
  for (const { heading, lines } of required) {
    const section = found.get(headingKey(heading));
    if (!section) {
      problems.push(`\`${heading}\` is missing.`);
      continue;
    }
    const text = content(section);
    if (text === '') {
      problems.push(`\`${heading}\` is empty.`);
    } else if (text.split('\n').some(line => line.trim() === PLACEHOLDER)) {
      // The template puts the placeholder on a line of its own, so an ellipsis
      // inside a sentence is prose rather than an unfilled section.
      problems.push(`\`${heading}\` still holds the \`${PLACEHOLDER}\` placeholder.`);
    } else if (text === content({ lines })) {
      problems.push(`\`${heading}\` still holds the text from the template.`);
    }
  }
  return problems;
}

async function syncComment({ github, context, core }, issueNumber, marker, body) {
  const { owner, repo } = context.repo;
  try {
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
    });
    const ours = comments.filter(
      comment => comment.user?.login === LE_BOT_USERNAME && comment.body?.includes(marker),
    );
    if (body === null) {
      await Promise.all(
        ours.map(comment =>
          github.rest.issues.deleteComment({ owner, repo, comment_id: comment.id }),
        ),
      );
    } else if (!ours.length) {
      await github.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    } else if (ours[0].body !== body) {
      await github.rest.issues.updateComment({ owner, repo, comment_id: ours[0].id, body });
    }
  } catch (error) {
    core.warning(`Could not update the template comment: ${error.message}`);
  }
}

module.exports = { headingKey, sections, requiredSections, failures, syncComment };
