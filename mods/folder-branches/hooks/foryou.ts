// B317: the "For you" block a chat ends its answer with, in the project's form (its CLAUDE.md, parts 2 and 2b):
//
//   > **For you**
//   > 1. **Answer:** <a question, with the advice: "I advise B">
//   >    [See the picture: <what>](http://127.0.0.1:<port>/#picture=<path>)
//   >    [Play it: <where>](http://127.0.0.1:<port>/#play=<branch>&<settings>)
//   > 2. **Do:** <an action>
//
// read as the asks it stands for, so the Workers mod can file those the chat did not file with `work ask`. The rules
// follow the board's own reading of such a block (src/handover.mjs: `asksAtEnd`, `parseHandover`): its last block,
// followed by nothing but blank lines, a rule and the closing block; a title or an item written a little off still
// counts. Nothing here is trusted beyond its shape: the board checks every field again.

/** One item of the block as an ask: the fields of `work ask`, its number, and the ask's id when the item names one. */
export type ForYouItem = {
  n: number
  kind: 'decide' | 'look' | 'do'
  /** Its words: the item's first line, then its other lines (links left out). */
  text: string[]
  /** Each with its letter ("A thin"), or the letters alone when the words only name them ("A, B or C?"). */
  options: string[]
  advice: string
  pictures: string[]
  /** `<branch>&<settings>`, as `work ask` takes it; '' for none. */
  play: string
  /** The ask's id when the item is one the work tool wrote ("... (Q4, decide, blocks B1)"), else null. */
  ref: string | null
}

const TITLE = /^>\s*\*{0,2}\s*(?:for you|needs your attention)\s*:?\s*\*{0,2}\s*:?\s*$/i
const ITEM = /^(\d{1,2})[.)]\s+(?:(?:\*\*)?(Answer|Do)(?:\s*:\s*\*\*|\*\*\s*:|\s*:)\s*)?(.*)$/i
const OPTION_LINE = /^[-*]\s+(?:\*\*\(?([A-H])[:.)]?\*\*[:.)]?|\(?([A-H])[:.)])\s+(.+)$/
const LINK = /\[([^\]\n]{1,200})\]\((?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{2,5})?\/?)?#(picture|play)=([^)\s]{1,600})\)/g
const PLAIN_PATH = /^[\w-][\w.@ -]*(\/[\w.@ -]+)+$/
const BRANCH = /^[\w][\w./-]{0,120}$/
const SETTINGS = /^[\w.,=&%-]{0,400}$/
const NAMED = /\b((?:[A-H],\s*)*[A-H]),?\s+or\s+([A-H])\b/
const ADVICE = /\b(?:I(?:\s+would|'d)?\s+(?:advise|recommend)|my advice(?:\s+is)?\s*:?)\s+([^.;,!?(\n]{1,120})/i
const REF = /\((Q\d+),\s*(?:decide|look|provide|do)\b[^)]*\)\s*$/
const ITEMS = 9
const LINE_CHARS = 1000
/** What the items may take of the board's call at the turn's end, as JSON: the board takes 16 KB in all. */
export const ITEMS_CHARS = 12000

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, LINE_CHARS)

function decoded(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

/** The answer without its closing block, and without the rule above it. */
function withoutClosing(text: string): string {
  return text.replace(/\n?(?:-{3,}\s*\n+)?```diff[^\n]*\n[\s\S]*?```\s*$/, '').trimEnd()
}

/** The quoted lines of the answer's last "For you" block, when nothing but a rule and the closing block follow it. */
function lastBlock(text: string): string[] | null {
  const lines = text.replace(/\r/g, '').split('\n')
  let start = lines.length - 1
  while (start >= 0 && !TITLE.test(lines[start].trim())) start -= 1
  if (start < 0) return null
  let after = start + 1
  while (after < lines.length && lines[after].trim().startsWith('>')) after += 1
  const rest = withoutClosing(lines.slice(after).join('\n')).trim()
  if (rest !== '' && !/^(?:-{3,}|\*{3,}|_{3,})$/.test(rest)) return null
  return lines.slice(start + 1, after).map(line => line.trim().replace(/^>\s?/, ''))
}

type Parts = { words: string; pictures: string[]; plays: string[] }

/** A line's links to the board taken out: the pictures' paths and the plays, and the words left. */
function linksIn(text: string): Parts {
  const pictures: string[] = []
  const plays: string[] = []
  const words = text.replace(LINK, (whole: string, _label: string, kind: string, target: string) => {
    if (kind === 'picture') {
      const path = decoded(target)
      if (path === null || !PLAIN_PATH.test(path) || path.split('/').includes('..')) return whole
      pictures.push(path)
      return ''
    }
    const [first, ...rest] = target.split('&')
    const branch = decoded(first)
    const settings = rest.join('&')
    if (branch === null || !BRANCH.test(branch) || branch.includes('..') || !SETTINGS.test(settings)) return whole
    plays.push(settings === '' ? branch : `${branch}&${settings}`)
    return ''
  })
  return { words, pictures, plays }
}

/**
 * The options a question's words give, when they are clear: "A thin, B thick or C none" (each letter in order from
 * A, after the start, a space or a mark, with its words, the parts parted by a comma, a semicolon, a slash or "or"),
 * or the letters alone ("A, B or C?"). None otherwise: "Box or yew?" names no lettered option.
 */
export function inlineOptions(ask: string): string[] {
  const words = ask.replace(ADVICE, ' ').replace(/\s+/g, ' ')
  const labels: { key: string; at: number; end: number }[] = []
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
      const options: string[] = []
      let isClear = true
      chain.forEach((label, index) => {
        const next = chain[index + 1]
        const raw = next === undefined ? words.slice(label.end).split(/[?;]|\.(?:\s|$)/)[0] : words.slice(label.end, next.at)
        if (next !== undefined && !/(?:,|;|\/|\bor)\s*\(?\s*$/i.test(raw)) isClear = false
        const own = raw.replace(/(?:\s*(?:,|;|\/|\bor\b))+\s*\(?\s*$/i, '').trim()
        if (own === '' || own.length > 120) isClear = false
        options.push(`${label.key} ${own}`)
      })
      if (isClear) return options
    }
  }
  const named = words.match(NAMED)
  if (named === null) return []
  const keys = [...named[1].split(',').map(key => key.trim()), named[2]]
  return keys.every((key, index) => key === String.fromCharCode(65 + index)) ? keys : []
}

/**
 * B317: the items of the "For you" block the answer ends with, as asks: an "Answer:" is a decide, or a look when it
 * shows a picture or a play link and gives no options; a "Do:" is a do; a numbered item with neither word is a
 * decide. Options from lines under the item ("- **A:** red") or from its words; the advice from "I advise ...";
 * nine items at most, and no more than fit the board's call (ITEMS_CHARS). None when the answer does not end with such a block (a block quoted earlier is another's).
 */
export function forYouItems(answer: unknown): ForYouItem[] {
  if (typeof answer !== 'string' || answer.trim() === '') return []
  const block = lastBlock(answer)
  if (block === null) return []
  const items: (ForYouItem & { lined: string[] })[] = []
  for (const inner of block) {
    const line = inner.trim()
    const head = line.match(ITEM)
    if (head !== null) {
      if (items.length >= ITEMS) break
      const { words, pictures, plays } = linksIn(head[3])
      items.push({ n: Number(head[1]), kind: head[2]?.toLowerCase() === 'do' ? 'do' : 'decide', text: [oneLine(words)], options: [], advice: '', pictures, play: plays[0] ?? '', ref: null, lined: [] })
      continue
    }
    const item = items[items.length - 1]
    if (item === undefined || line === '') continue
    const { words, pictures, plays } = linksIn(line)
    item.pictures.push(...pictures)
    if (item.play === '' && plays.length > 0) item.play = plays[0]
    const said = oneLine(words)
    if (said === '') continue
    const option = said.match(OPTION_LINE)
    if (option !== null) item.lined.push(`${option[1] ?? option[2]} ${oneLine(option[3])}`)
    else item.text.push(said)
  }
  const all = items.filter(item => item.text[0] !== '' || item.text.length > 1).map(({ lined, ...item }) => {
    const text = item.text[0] === '' ? item.text.slice(1) : item.text
    const ref = text[0].match(REF)?.[1] ?? null
    const options = item.kind === 'do' ? [] : lined.length > 0 ? lined : inlineOptions(text[0].replace(REF, ''))
    const advice = text.join(' ').match(ADVICE)?.[1].replace(/\*+/g, '').trim() ?? ''
    const kind = item.kind === 'do' ? 'do' : options.length === 0 && (item.pictures.length > 0 || item.play !== '') ? 'look' : 'decide'
    return { ...item, kind, text, options: options.slice(0, 8), advice, pictures: [...new Set(item.pictures)].slice(0, 8), ref }
  })
  // The items that fit the call, in order; one that would not fit and those after it are left out.
  const kept: ForYouItem[] = []
  let size = 0
  for (const item of all) {
    size += JSON.stringify(item).length + 1
    if (size > ITEMS_CHARS) break
    kept.push(item)
  }
  return kept
}

/**
 * B317: the line beside the chat's next prompt, once, naming the asks the board filed from its last "For you" block,
 * so it can close one the person answers in the chat instead; null when there are none.
 */
export function blockAsksLine(ids: readonly unknown[]): string | null {
  const own = ids.filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id))
  if (own.length === 0) return null
  return `Filed on the worker board from your last "For you" block: ${own.join(', ')}. The person answers there; if they answer one here in the chat instead, close it with work answered-in-chat <id> and their words.`
}
