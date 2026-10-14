// B149: the parts of a worker's last answer when it finished a task and something is left for the person, in the
// form the project's CLAUDE.md gives the chats (part "2b"):
//
//   **Task:** <the task as it was given>
//   **What I did:** <one to three lines>
//
//   > **For you**
//   > 1. **Answer:** <a question>
//   >    [See the picture: <what it shows>](http://127.0.0.1:4310/#picture=art-inbox/<subject>/<file>.png)
//   > 2. **Answer:** <a check in the game>
//   >    [Play it: <where>](http://127.0.0.1:4310/#play=<branch>&arena=crossing&enemies=skeletons)
//   > 3. **Do:** <an action>
//
// and the closing block (a `diff` block of three lines: Prompt, Who, Done). The words come from a chat: nothing here
// is trusted beyond its shape. A picture's path is only named here; the board decides on its own whether it may
// show it. A branch and the game's settings are kept to plain characters.

const LINK = /\[([^\]\n]{1,200})\]\((?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{2,5})?\/?)?#(picture|play)=([^)\s]{1,600})\)/g
const ITEM = /^(\d{1,2})\.\s+\*\*(Answer|Do):\*\*\s*(.*)$/
const PLAIN_PATH = /^[\w-][\w.@ -]*(\/[\w.@ -]+)+$/
const BRANCH = /^[\w][\w./-]{0,120}$/
const SETTINGS = /^[\w.,=&%-]{0,400}$/
const TEXT_CHARS = 1000
const ITEMS = 9

const oneLine = (text, most = TEXT_CHARS) => text.replace(/\s+/g, ' ').trim().slice(0, most)

function decoded(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** A link of the form above: `{ kind: 'picture', label, path }` or `{ kind: 'play', label, branch, settings }`, or null. */
function linkOf(label, kind, target) {
  if (kind === 'picture') {
    const path = decoded(target)
    return path !== null && PLAIN_PATH.test(path) && !path.split('/').includes('..') ? { kind, label: oneLine(label, 200), path } : null
  }
  const [first, ...rest] = target.split('&')
  const branch = decoded(first)
  const settings = rest.join('&')
  return branch !== null && BRANCH.test(branch) && !branch.includes('..') && SETTINGS.test(settings) ? { kind, label: oneLine(label, 200), branch, settings } : null
}

/** The links of a text, and the text with each link replaced by its label. */
function linksIn(text) {
  const links = []
  const words = text.replace(LINK, (whole, label, kind, target) => {
    const link = linkOf(label, kind, target)
    if (link !== null) links.push(link)
    return link === null ? whole : ''
  })
  return { links, words }
}

/** The closing block's three lines: `{ prompt, who, done, isDone }` (`isDone` true for "+", false for "-"), or null. */
export function closingOf(text) {
  const block = text.match(/```diff[^\n]*\n([\s\S]*?)```/g)?.pop() ?? null
  if (block === null) return null
  const closing = { prompt: null, who: null, done: null, isDone: null }
  for (const line of block.split('\n')) {
    const found = line.match(/^([+-]?)\s*(Prompt|Who|Done):\s*(.*)$/)
    if (found === null) continue
    const key = found[2].toLowerCase()
    closing[key] = oneLine(found[3], 300)
    if (key === 'done') closing.isDone = found[1] === '+' ? true : found[1] === '-' ? false : null
  }
  return closing.prompt === null && closing.who === null && closing.done === null ? null : closing
}

/** The answer without its closing block, and without the rule that stands above it. */
export function withoutClosing(text) {
  return text.replace(/\n?(?:-{3,}\s*\n+)?```diff[^\n]*\n[\s\S]*?```\s*$/, '').trimEnd()
}

/** A line of the form "**Task:** ..." and the lines that follow it up to an empty line. */
function labelled(lines, label) {
  const at = lines.findIndex(line => line.trim().startsWith(`**${label}:**`))
  if (at < 0) return null
  const taken = [lines[at].trim().slice(label.length + 5).trim()]
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '' || line.trim().startsWith('**') || line.startsWith('>')) break
    taken.push(line.trim())
  }
  const words = taken.join('\n').trim()
  return words === '' ? null : words.slice(0, TEXT_CHARS)
}

/**
 * The parts of a worker's last answer: `{ task, did, items, closing, rest }`. `items` are the "For you" block's, in
 * order, each `{ n, kind: 'answer' | 'do', text, links }`; `rest` is the answer without its closing block. Null when
 * the answer has none of the parts, so the board shows it as it is.
 */
export function parseHandover(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const lines = text.replace(/\r/g, '').split('\n')
  const task = labelled(lines, 'Task')
  const did = labelled(lines, 'What I did')

  // The "For you" block: the quoted lines from its title on.
  const items = []
  const start = lines.findIndex(line => /^>\s*\*\*For you\*\*\s*$/.test(line.trim()))
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (!line.trim().startsWith('>')) break
      const inner = line.trim().replace(/^>\s?/, '')
      const head = inner.trim().match(ITEM)
      if (head !== null && items.length < ITEMS) {
        const { links, words } = linksIn(head[3])
        items.push({ n: Number(head[1]), kind: head[2].toLowerCase(), text: oneLine(words), links })
        continue
      }
      const item = items.at(-1)
      if (item === undefined || inner.trim() === '') continue
      const { links, words } = linksIn(inner)
      item.links.push(...links)
      if (words.trim() !== '') item.text = oneLine(`${item.text} ${words}`)
    }
  }

  const closing = closingOf(text)
  if (task === null && did === null && items.length === 0 && closing === null) return null
  return { task, did, items, closing, rest: withoutClosing(text) }
}
