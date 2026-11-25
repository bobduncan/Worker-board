// B417 (robustness page, place 6): the one grammar of the "For you" block a chat ends its answer with, in the project's
// form (its CLAUDE.md, parts 2 and 2b):
//
//   > **For you**
//   > 1. **Answer:** <a question, with the advice: "I advise B">
//   >    [See the picture: <what>](http://127.0.0.1:<port>/#picture=<path>)
//   >    [Play it: <where>](http://127.0.0.1:<port>/#play=<branch>&<settings>)
//   > 2. **Do:** <an action>
//
// Three readers used to parse it three ways (the mod's foryou.ts, handover.mjs `asksAtEnd` and `parseHandover`), so an
// item written `**Answer**:` was a question to one and no item to another. Every reader of the block now goes through
// this module, and the Workers mod only sends the answer's tail with the turn's end (hooks/foryou.ts, `forYouTail`): the
// board reads it once (api.mjs, `askForYou`). The block is read a little leniently: a title or an item written a little off still
// counts (`**For you:**`, `**Answer**:`, `Answer:`, `1)`, a numbered item with neither word). The words come from a
// chat: nothing here is trusted beyond its shape; a picture's path is only named here, the board decides on its own
// whether it may show it; a branch and the game's settings are kept to plain characters. PURE.

/** A title: "For you", also written a little off ("**For you:**", "For you"), or under the board's name for it. */
export const TITLE = /^>\s*\*{0,2}\s*(?:for you|needs your attention)\s*:?\s*\*{0,2}\s*:?\s*$/i
/** An item: its number, its word (`Answer` or `Do`, none for a plain numbered item) and the rest of its first line. */
export const ITEM = /^(\d{1,2})[.)]\s+(?:(?:\*\*)?(Answer|Do)(?:\s*:\s*\*\*|\*\*\s*:|\s*:)\s*)?(.*)$/i
/** A choice under an item: "- **A:** red", "- A) red", "- (A) red". */
const OPTION = /^[-*]\s+(?:\*\*\(?([A-H])[:.)]?\*\*[:.)]?\s*|\(?([A-H])[:.)]\s+)(.*)$/
const LINK = /\[([^\]\n]{1,200})\]\((?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{2,5})?\/?)?#(picture|play)=([^)\s]{1,600})\)/g
const PLAIN_PATH = /^[\w-][\w.@ -]*(\/[\w.@ -]+)+$/
const BRANCH = /^[\w][\w./-]{0,120}$/
const SETTINGS = /^[\w.,=&%-]{0,400}$/
const NAMED = /\b((?:[A-H],\s*)*[A-H]),?\s+or\s+([A-H])\b/
const ADVICE = /\b(?:I(?:\s+would|'d)?\s+(?:advise|recommend)|my advice(?:\s+is)?\s*:?)\s+([^.;,!?(\n]{1,120})/i
const REF = /\((Q\d+),\s*(?:decide|look|provide|do)\b[^)]*\)\s*$/
const RULE = /^(?:-{3,}|\*{3,}|_{3,})$/
/** The most items of a block that are read. */
export const ITEMS = 9
/** The longest line of an item. */
export const LINE_CHARS = 1000
/** What the items may take of the board's call at the turn's end, as JSON: the board takes 16 KB in all. */
export const ITEMS_CHARS = 12000

export const oneLine = (text, most = LINE_CHARS) => String(text).replace(/\s+/g, ' ').trim().slice(0, most)

function decoded(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** The answer without its closing block (a `diff` block of three lines), and without the rule that stands above it. */
export function withoutClosing(text) {
  return text.replace(/\n?(?:-{3,}\s*\n+)?```diff[^\n]*\n[\s\S]*?```\s*$/, '').trimEnd()
}

/**
 * The answer's last "For you" block (a block quoted earlier is someone else's): `{ lines, start, after, inner, atEnd }`.
 * `start` is its title's line, `after` the line after its quoted lines, `inner` its quoted lines without their ">",
 * `atEnd` whether nothing but blank lines, a rule and the closing block follow it: only such a block asks the person
 * something. Null when the answer holds none.
 */
export function blockOf(text) {
  if (typeof text !== 'string') return null
  const lines = text.replace(/\r/g, '').split('\n')
  const start = lines.findLastIndex(line => TITLE.test(line.trim()))
  if (start < 0) return null
  let after = start + 1
  while (after < lines.length && lines[after].trim().startsWith('>')) after += 1
  const rest = withoutClosing(lines.slice(after).join('\n')).trim()
  return { lines, start, after, inner: lines.slice(start + 1, after).map(line => line.trim().replace(/^>\s?/, '')), atEnd: rest === '' || RULE.test(rest) }
}

/** Whether an answer ends by asking the person something: its last block is followed by nothing but a rule and the closing block. */
export const asksAtEnd = text => blockOf(text)?.atEnd === true

/** The head of an item line: `{ n, word: 'answer' | 'do' | null, words }`, or null for a line that starts no item. */
export function itemHead(line) {
  const head = String(line).trim().match(ITEM)
  return head === null ? null : { n: Number(head[1]), word: head[2]?.toLowerCase() ?? null, words: head[3] }
}

/** A line under an item that lists a choice: `{ key, text }`, or null. */
export function optionOf(line) {
  const found = String(line).trim().match(OPTION)
  return found === null ? null : { key: found[1] ?? found[2], text: oneLine(found[3], 400) }
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

/** The links to the board in a text, and the text with each link taken out. */
export function linksIn(text) {
  const links = []
  const words = text.replace(LINK, (whole, label, kind, target) => {
    const link = linkOf(label, kind, target)
    if (link !== null) links.push(link)
    return link === null ? whole : ''
  })
  return { links, words }
}

/**
 * The options a question's words give, when they are clear: "A thin, B thick or C none" (each letter in order from A,
 * after the start, a space or a mark, with its words, the parts parted by a comma, a semicolon, a slash or "or"), or
 * the letters alone ("A, B or C?"). Each `{ key, text }`, `text` null for the letters alone. None otherwise: "Box or
 * yew?" names no lettered option.
 */
export function inlineOptions(ask) {
  const words = ask.replace(ADVICE, ' ').replace(/\s+/g, ' ')
  const labels = []
  const found = /(^|[\s(,;:/])\(?([A-H])(?:\)|:)?\s+(?=\S)/g
  for (let match = found.exec(words); match !== null; match = found.exec(words)) {
    const at = match.index + match[1].length
    labels.push({ key: match[2], at, end: match.index + match[0].length })
    found.lastIndex = match.index + match[0].length
  }
  const firstA = labels.findIndex(label => label.key === 'A')
  if (firstA >= 0) {
    const chain = [labels[firstA]]
    for (const label of labels.slice(firstA + 1)) if (label.key === String.fromCharCode(65 + chain.length)) chain.push(label)
    if (chain.length >= 2) {
      const options = []
      let isClear = true
      chain.forEach((label, index) => {
        const next = chain[index + 1]
        const raw = next === undefined ? words.slice(label.end).split(/[?;]|\.(?:\s|$)/)[0] : words.slice(label.end, next.at)
        if (next !== undefined && !/(?:,|;|\/|\bor)\s*\(?\s*$/i.test(raw)) isClear = false
        const own = raw.replace(/(?:\s*(?:,|;|\/|\bor\b))+\s*\(?\s*$/i, '').trim()
        if (own === '' || own.length > 120) isClear = false
        options.push({ key: label.key, text: own })
      })
      if (isClear) return options
    }
  }
  const named = words.match(NAMED)
  if (named === null) return []
  const keys = [...named[1].split(',').map(key => key.trim()), named[2]]
  return keys.every((key, index) => key === String.fromCharCode(65 + index)) ? keys.map(key => ({ key, text: null })) : []
}

/** An option as `work ask` takes it: its letter and its words ("A thin"), or the letter alone. */
const asOption = option => (option.text === null ? option.key : `${option.key} ${option.text}`)

/**
 * The items of a block's lines, in order, each `{ n, word, head, lines }`: `head` the first line's words, `lines` the
 * non-empty lines under it, as written. Lines before the first item belong to none.
 */
export function itemsOf(inner) {
  const items = []
  for (const raw of inner) {
    const line = raw.trim()
    const head = itemHead(line)
    if (head !== null) {
      items.push({ n: head.n, word: head.word, head: head.words, lines: [] })
      continue
    }
    if (items.length > 0 && line !== '') items.at(-1).lines.push(line)
  }
  return items
}

/**
 * The items of the "For you" block the answer ends with, as asks (the fields of `work ask`): an "Answer:" is a decide,
 * or a look when it shows a picture or a play link and gives no options; a "Do:" is a do; a numbered item with neither
 * word is a decide. Options from lines under the item or from its words; the advice from "I advise ..."; the ask's id
 * when the item is one the work tool wrote ("... (Q4, decide, blocks B1)"). `{ items, total }`: at most `most` items,
 * as long as they fit `chars` of the call (a longer one and those after it are left out), and `total`, how many the
 * block holds. Empty when the answer does not end with such a block (a block quoted earlier is another's).
 */
export function forYouAsks(answer, { most = ITEMS, chars = ITEMS_CHARS } = {}) {
  const block = typeof answer === 'string' && answer.trim() !== '' ? blockOf(answer) : null
  if (block === null || !block.atEnd) return { items: [], total: 0 }
  const read = []
  for (const item of itemsOf(block.inner)) {
    const { links, words } = linksIn(item.head)
    const own = { word: item.word, text: [oneLine(words)], pictures: links.filter(link => link.kind === 'picture').map(link => link.path), plays: links.filter(link => link.kind === 'play').map(link => (link.settings === '' ? link.branch : `${link.branch}&${link.settings}`)), lined: [] }
    for (const line of item.lines) {
      const under = linksIn(line)
      own.pictures.push(...under.links.filter(link => link.kind === 'picture').map(link => link.path))
      own.plays.push(...under.links.filter(link => link.kind === 'play').map(link => (link.settings === '' ? link.branch : `${link.branch}&${link.settings}`)))
      const said = oneLine(under.words)
      if (said === '') continue
      const option = optionOf(said)
      if (option !== null) own.lined.push(`${option.key} ${option.text}`)
      else own.text.push(said)
    }
    read.push({ ...own, n: item.n })
  }
  const all = read.filter(item => item.text[0] !== '' || item.text.length > 1).map(item => {
    const text = item.text[0] === '' ? item.text.slice(1) : item.text
    const ref = text[0].match(REF)?.[1] ?? null
    const isDo = item.word === 'do'
    const options = isDo ? [] : item.lined.length > 0 ? item.lined : inlineOptions(text[0].replace(REF, '')).map(asOption)
    const advice = text.join(' ').match(ADVICE)?.[1].replace(/\*+/g, '').trim() ?? ''
    const play = item.plays[0] ?? ''
    const kind = isDo ? 'do' : options.length === 0 && (item.pictures.length > 0 || play !== '') ? 'look' : 'decide'
    return { n: item.n, kind, text, options: options.slice(0, 8), advice, pictures: [...new Set(item.pictures)].slice(0, 8), play, ref }
  })
  const kept = []
  let size = 0
  for (const item of all.slice(0, most)) {
    size += JSON.stringify(item).length + 1
    if (size > chars) break
    kept.push(item)
  }
  return { items: kept, total: all.length }
}
