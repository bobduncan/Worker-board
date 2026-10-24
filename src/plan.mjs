// Plan (brainstorm of 2026-10-19): the product plan, the answers every goal and step falls back to (roles/partner.md,
// "The plan interview"), read from the game's `docs/product-plan.md` (the setting `productPlan`; the project's own
// folder while there is no game folder yet) for the Vision tab.
// The partner writes the page; the board only reads it and types the person's moves and answers to the partner.
// Under the page's title a line "Pitch: <one sentence>". One heading per answer, "## P<n> · <title>", and under it
// lines "- State: decided (from ..., <date>)", "- Answer: <one line>", "- Point: **<lead>** <words>" (two to four),
// "- Picture: <path> · <caption>", "- Known: ..." (an open one), "- Overturned (<date>): ...". The heading
// "## Features" holds one "### F<n> · <name>" per feature with "- Mark: must|later|no|unsure (<who>, <date>)",
// "- Complex: yes · <why>" or "no", "- Built: yes|partly|no", "- Picture: ...", "- Point: ...". The heading
// "## Goals preset" holds "### M<n> · <milestone>" with its goals "#### S<n> · <title>": "- State: proposed" or
// "confirmed (you, <date>)", "- Done when: ...", "- Serves: P2, P3", "- Picture: ...", "- Sub: ..." (its sub-goals),
// "- Goal: G<n>" (the goal of the map it is). The heading "## The log" holds the chats' walk-up lines: "- hit P3: ...",
// "- gap: ...", "- overturned P2: ...".

import { askFiledMs, valueOf } from './work/item.mjs'

const HEAD = /^##\s+(P\d+)\s*[·:-]\s*(.*)$/
const LINE = /^-\s+([A-Z][A-Za-z ]*?)(?:\s*\(([^)]*)\))?:\s*(.*)$/
const STATES = ['decided', 'assumed', 'open']

/** A state line's word: "decided", "assumed" or "open"; anything else reads as "open", never as decided. */
function stateOf(value) {
  const word = String(value ?? '').trim().split(/[\s(·]/)[0].toLowerCase()
  return STATES.includes(word) ? word : 'open'
}

/** "revisit after M1 is played" out of a state line, or null. */
function revisitOf(value) {
  const match = String(value ?? '').match(/revisit after\s+([^·]+)/i)
  return match === null ? null : match[1].trim()
}

/** "(from game-vision.md, 2026-10-10)" or "(you, 2026-10-19)" out of a state line: `from` a document, `by`, `at`. */
function sourceOf(value) {
  // A link "[game-vision.md](game-vision.md)" is its words first, so its own brackets do not end the source.
  const match = String(value ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').match(/\(([^)]*)\)/)
  if (match === null) return { from: null, by: null, at: null }
  const parts = match[1].split(',').map(one => one.trim()).filter(Boolean)
  const at = parts.find(one => /^\d{4}-\d{2}-\d{2}/.test(one)) ?? null
  const rest = parts.filter(one => one !== at)
  const from = rest.find(one => /^from\s+/i.test(one))?.replace(/^from\s+/i, '') ?? null
  const by = rest.find(one => !/^from\s+/i.test(one)) ?? null
  return { from, by, at }
}

/** A sentence with its first letter a capital, as a question on its slide reads. */
const capital = text => (text === '' ? text : text[0].toUpperCase() + text.slice(1))

/** "<path> · the look we aim for": the path (in a picture folder of the settings) and its caption. */
function pictureOf(value) {
  const [path, ...caption] = String(value).split(' · ')
  return { path: path.trim(), caption: caption.join(' · ').trim() }
}

/**
 * Whether an option is the advised one: the advice is the option itself, or names its letter first ("A, revisit after
 * M2" advises "A a link for friends").
 */
function isAdvised(label, advice) {
  if (advice === null || advice === '') return false
  if (label === advice || label.toLowerCase().startsWith(`${advice.toLowerCase()} `)) return true
  const key = String(advice).match(/^([A-Za-z0-9]+)\b/)?.[1]
  return key !== undefined && key.length <= 2 && label.toLowerCase().startsWith(`${key.toLowerCase()} `)
}

/**
 * An option of the partner's ask as a card: "A A link for friends: free, unlisted; ask again after M2" is the key "A",
 * the head "A link for friends" and the points "free, unlisted" and "ask again after M2". Without a colon the whole
 * option is its head; without a letter of one or two characters first, the key is empty.
 */
export function optionCard(label) {
  const text = String(label).trim()
  const key = text.match(/^([A-Z0-9]{1,2})\s+(?=\S)/)?.[1] ?? ''
  const rest = key === '' ? text : text.slice(key.length).trim()
  const at = rest.indexOf(':')
  if (at < 0) return { key, head: rest, points: [] }
  return { key, head: rest.slice(0, at).trim(), points: rest.slice(at + 1).split(';').map(one => one.trim()).filter(Boolean) }
}

const MARKS = ['must', 'later', 'no', 'unsure']

/** A feature's mark: "must", "later", "no" or "unsure" ("?" and "not sure" too); anything else reads as unsure. */
function markOf(value) {
  const text = String(value ?? '').trim()
  if (text.startsWith('?') || /^not\s+sure/i.test(text)) return 'unsure'
  // A mark written as a milestone ("M2", "M3+"; the plan check of 2026-10-21 wrote so for a while): the open end is
  // later, any other milestone is must (the milestone itself is the feature's Milestone).
  const milestone = text.match(/^(M\d+\+?)(?=[\s(·]|$)/i)
  if (milestone !== null) return milestone[1].endsWith('+') ? 'later' : 'must'
  const word = text.split(/[\s(·]/)[0].toLowerCase()
  return MARKS.includes(word) ? word : 'unsure'
}

/** The milestone of the road a mark or a Milestone line names ("M1", "M3+"), or null. */
const milestoneOf = value => String(value ?? '').trim().match(/^(M\d+\+?)(?=[\s(·]|$)/i)?.[1].toUpperCase() ?? null

/**
 * More words onto a standard's last bar point. A bar point may end with its picture, the aspect it names highlighted:
 * "... · <picture folder>/x.png" (2026-10-20); the picture goes to `barPictures`, the words stay the point, also when
 * the picture comes on a wrapped line.
 */
function setBar(current, words) {
  const at = current.bar.length - 1
  const joined = `${current.bar[at]} ${words}`.trim()
  const parts = joined.split(' · ')
  const last = parts.at(-1).trim()
  if (parts.length > 1 && /\.(png|jpe?g|webp|gif)$/i.test(last)) {
    if (!current.barPictures.some(one => one.at === at)) current.barPictures.push({ at, path: last })
    current.bar[at] = parts.slice(0, -1).join(' · ').trim()
  } else current.bar[at] = joined
}

/**
 * The page's pitch, answers, features, goal preset and log. `pitch`: the "Pitch:" line above the first answer, or ''.
 * `answers`: one per "## P<n>" heading, in the page's order: `id`, `title`, `state`, `detail` (the state line after its
 * word), `from`, `by`, `at`, `revisit`, `answer` (the Answer line and its indented continuation, one line), `points`,
 * `pictures` (`{ path, caption }`), `known` (the Known line of an open answer), `overturned` (its lines). `features`:
 * one per "### F<n>" under "## Features": `id`, `name`, `mark`, `by`, `from`, `at`, `isComplex`, `why` (of complex),
 * `built`, `pictures`, `points`. `milestones`: one per "### M<n>" under "## Goals preset", each with its `goals`:
 * `id`, `title`, `state` (proposed or confirmed), `by`, `at`, `doneWhen`, `serves`, `pictures`, `subs`, `goal`. `log`:
 * the counts of hits, gaps and overturned lines, and the lines. An empty or missing page gives none of them.
 */
export function parsePlan(text) {
  const answers = []
  const features = []
  const milestones = []
  const standards = []
  const log = { hits: 0, gaps: 0, overturned: 0, lines: [] }
  let pitch = ''
  // The new order (2026-10-21): the partner's plan check ("Checked: ..." under the goals preset) and its proposed next
  // focus ("## Next focus").
  let check = null
  let nextFocus = null
  // 2026-10-24: the strategy the plan is laid in, and the partner's advice for it before you chose.
  let strategy = null
  let strategyAdvice = null
  if (typeof text !== 'string') return { pitch, answers, features, milestones, standards, log, check, nextFocus, strategy, strategyAdvice }
  let current = null
  let kind = null
  let section = 'top'
  let field = null
  for (const raw of text.split(/\r?\n/)) {
    const head = raw.match(HEAD)
    if (head !== null) {
      current = { id: head[1], title: head[2].trim(), state: 'open', detail: '', from: null, by: null, at: null, revisit: null, answer: '', points: [], pictures: [], known: '', overturned: [], advice: '', settled: null, icons: [] }
      answers.push(current)
      kind = 'answer'
      section = 'answers'
      field = null
      continue
    }
    if (/^##\s+[^#]/.test(raw)) {
      section = /^##\s+the log\b/i.test(raw) ? 'log' : /^##\s+features\b/i.test(raw) ? 'features' : /^##\s+goals preset\b/i.test(raw) ? 'preset' : /^##\s+standards\b/i.test(raw) ? 'standards'
        : /^##\s+next focus\b/i.test(raw) ? 'next' : 'other'
      current = null
      kind = null
      field = null
      continue
    }
    const feature = section === 'features' ? raw.match(/^###\s+(F\d+)\s*[·:-]\s*(.*)$/) : null
    if (feature !== null) {
      current = { id: feature[1], name: feature[2].trim(), mark: 'unsure', milestone: null, prepare: null, tradeoff: null, tradeoffAt: null, by: null, from: null, at: null, isComplex: false, why: '', built: 'no', pictures: [], points: [] }
      features.push(current)
      kind = 'feature'
      field = null
      continue
    }
    const standard = section === 'standards' ? raw.match(/^###\s+(K\d+)\s*[·:-]\s*(.*)$/) : null
    if (standard !== null) {
      current = { id: standard[1], title: standard[2].trim(), state: 'proposed', by: null, at: null, count: '', kind: '', done: '', reference: null, today: null, pictures: [], bar: [], barLevels: [], barPictures: [], foundation: '', foundationBuilt: false, perItem: '', score: '', met: null, total: null, gap: '' }
      standards.push(current)
      kind = 'standard'
      field = null
      continue
    }
    const milestone = section === 'preset' ? raw.match(/^###\s+(M\d+\+?)\s*[·:-]\s*(.*)$/) : null
    if (milestone !== null) {
      // 2026-10-24: a milestone a plan change touches carries its change and cause, as a goal does.
      current = { id: milestone[1], title: milestone[2].trim(), goals: [], change: null, cause: '' }
      milestones.push(current)
      kind = 'milestone'
      field = null
      continue
    }
    const goal = section === 'preset' && milestones.length > 0 ? raw.match(/^####\s+(S\d+)\s*[·:-]\s*(.*)$/) : null
    if (goal !== null) {
      current = { id: goal[1], title: goal[2].trim(), state: 'proposed', by: null, at: null, doneWhen: '', serves: [], pictures: [], subs: [], goal: null, why: '', change: null, cause: '', steps: '' }
      milestones.at(-1).goals.push(current)
      kind = 'goal'
      field = null
      continue
    }
    if (section === 'top') {
      const found = raw.match(/^Pitch:\s*(.+)$/)
      if (found !== null) pitch = found[1].trim()
      continue
    }
    if (section === 'log') {
      const entry = raw.match(/^-\s+(hit|gap|overturned)\b\s*(P\d+)?:?\s*(.*)$/i)
      if (entry === null || entry[3].trim() === '' && entry[2] === undefined) continue
      const word = entry[1].toLowerCase()
      if (word === 'hit') log.hits += 1
      else if (word === 'gap') log.gaps += 1
      else log.overturned += 1
      log.lines.push({ kind: word, id: entry[2] ?? null, text: entry[3].trim() })
      continue
    }
    // 2026-10-24: "Strategy: <name> (<who>, <date>) · <why>" and "Strategy advice: <name> · <why>".
    const advised = section === 'preset' ? raw.match(/^Strategy advice:\s*(.+)$/i) : null
    if (advised !== null) {
      const [name, ...why] = advised[1].split(' · ')
      strategyAdvice = { name: name.trim(), why: why.join(' · ').trim() }
      continue
    }
    const chosen = section === 'preset' ? raw.match(/^Strategy:\s*(.+)$/i) : null
    if (chosen !== null) {
      const [head, ...why] = chosen[1].split(' · ')
      const { by, at } = sourceOf(head)
      strategy = { name: head.replace(/\s*\([^)]*\)\s*$/, '').trim(), by, at, why: why.join(' · ').trim() }
      continue
    }
    // The plan check (2026-10-21): "Checked: (<date>) <what the partner proposed, or nothing missing>".
    const checked = section === 'preset' ? raw.match(/^Checked:\s*(.+)$/) : null
    if (checked !== null) {
      const { at } = sourceOf(checked[1])
      check = { at, text: checked[1].replace(/^\s*\([^)]*\)\s*/, '').trim() }
      continue
    }
    // The proposed next focus (2026-10-21): "- Proposed (<who>, <date>): G42 · <title>", "- Why: ...", "- When: ...",
    // "- Or: G44 · <title>" (at most two).
    if (section === 'next') {
      const said = raw.match(LINE)
      if (said === null) continue
      const [, name, inside, value] = said
      const key = name.trim().toLowerCase()
      nextFocus ??= { goal: null, title: '', why: '', when: '', others: [], by: null, at: null }
      const goalOf = words => {
        const [id, ...title] = String(words).split(' · ')
        return /^G\d+$/.test(id.trim()) ? { goal: id.trim(), title: title.join(' · ').trim() } : null
      }
      if (key === 'proposed') {
        Object.assign(nextFocus, goalOf(value) ?? { goal: null, title: value.trim() })
        const { by, at } = sourceOf(inside === undefined ? '' : `(${inside})`)
        Object.assign(nextFocus, { by, at })
      } else if (key === 'why') nextFocus.why = value.trim()
      else if (key === 'when') nextFocus.when = value.trim()
      else if (key === 'or') {
        const other = goalOf(value)
        if (other !== null && nextFocus.others.length < 2) nextFocus.others.push(other)
      }
      continue
    }
    if (current === null) continue
    const line = raw.match(LINE)
    if (line !== null) {
      const [, name, inside, value] = line
      const key = name.trim().toLowerCase()
      field = null
      if (key === 'picture') current.pictures.push(pictureOf(value))
      else if (kind === 'answer') {
        if (key === 'state') {
          current.state = stateOf(value)
          current.detail = value.replace(/^\s*(decided|assumed|open)\s*/i, '').trim()
          Object.assign(current, sourceOf(value))
          current.revisit = revisitOf(value)
        } else if (key === 'answer') { current.answer = value.trim(); field = 'answer' }
        else if (key === 'point') current.points.push(value.trim())
        else if (key === 'known') { current.known = value.trim(); field = 'known' }
        else if (key === 'overturned') current.overturned.push(`${inside === undefined ? '' : `${inside}: `}${value.trim()}`)
        // The partner's one line of advice on the card, and the card settled (a deeper round answered, or the
        // person's "Good enough"): "Settled: (you, 2026-10-20)" or "Settled: yes (you, 2026-10-20)".
        else if (key === 'advice') { current.advice = value.trim(); field = 'advice' }
        else if (key === 'settled') current.settled = /^no\b/i.test(value.trim()) ? null : { by: sourceOf(value).by ?? sourceOf(inside === undefined ? '' : `(${inside})`).by, at: sourceOf(value).at ?? sourceOf(inside === undefined ? '' : `(${inside})`).at }
        // A card without pictures shows icons instead (2026-10-20): "- Icon: store · Steam, later", a name of the
        // board's set or "badge:<letters>", with its caption.
        else if (key === 'icon') {
          const [name, ...caption] = value.split(' · ')
          if (name.trim() !== '') current.icons.push({ name: name.trim(), caption: caption.join(' · ').trim() })
        }
      } else if (kind === 'standard') {
        if (key === 'state') {
          current.state = /^(confirmed|agreed)\b/i.test(value.trim()) ? 'confirmed' : 'proposed'
          const { by, at } = sourceOf(value)
          Object.assign(current, { by, at })
        } else if (key === 'count') { current.count = value.trim(); field = 'count' }
        else if (key === 'kind') current.kind = value.trim()
        else if (key === 'done') current.done = value.trim()
        else if (key === 'reference') current.reference = pictureOf(value)
        else if (key === 'today') current.today = pictureOf(value)
        else if (key === 'bar') {
          current.bar.push('')
          current.barLevels.push(0)
          setBar(current, value)
          field = 'bar'
        }
        else if (key === 'foundation') { current.foundation = value.trim(); field = 'foundation' }
        // The guard (2026-10-21): "- Foundation built: yes (<step>, <date>)" once the foundation exists.
        else if (key === 'foundation built') current.foundationBuilt = /^yes\b/i.test(value.trim())
        else if (key === 'per item') current.perItem = value.trim()
        else if (key === 'score') {
          current.score = value.trim()
          const found = current.score.match(/^(\d+)\s+of\s+(\d+)\b/)
          current.met = found === null ? null : Number(found[1])
          current.total = found === null ? null : Number(found[2])
          field = 'score'
        } else if (key === 'gap') { current.gap = value.trim(); field = 'gap' }
      } else if (kind === 'feature') {
        if (key === 'mark') {
          current.mark = markOf(value)
          // An older mark written as a milestone keeps that milestone, unless a Milestone line says otherwise.
          current.milestone ??= milestoneOf(value)
          const { from, by, at } = sourceOf(value)
          Object.assign(current, { from, by, at })
        } else if (key === 'milestone') {
          // The plan check (2026-10-21): the milestone a must or later feature comes in, "- Milestone: M1 (partner, <date>)".
          current.milestone = milestoneOf(value)
        } else if (key === 'prepare') {
          // The partner's tradeoff (2026-10-21): "now · <what to build now> · now: <cost> · later: <what a late add
          // costs>", or "wait · <why adding it later costs about the same>".
          const [advice = '', ...rest] = value.split(' · ').map(part => part.trim())
          const of = start => rest.find(part => new RegExp(`^${start}\\s*:`, 'i').test(part))?.replace(/^\w+\s*:\s*/, '') ?? ''
          current.prepare = {
            advice: /^now\b/i.test(advice) ? 'now' : /^wait\b/i.test(advice) ? 'wait' : null,
            what: rest.filter(part => !/^(now|later)\s*:/i.test(part)).join(' · '), now: of('now'), later: of('later'),
          }
        } else if (key === 'tradeoff') {
          // The person's choice: "prepare (you, <date>)" or "wait (you, <date>)".
          const word = value.trim().split(/[\s(]/)[0].toLowerCase()
          current.tradeoff = word === 'prepare' || word === 'wait' ? word : null
          current.tradeoffAt = sourceOf(value).at
        } else if (key === 'complex') {
          current.isComplex = /^yes\b/i.test(value.trim())
          current.why = value.replace(/^\s*(yes|no)\s*[·:-]?\s*/i, '').trim()
        } else if (key === 'built') {
          const word = value.trim().toLowerCase().split(/\s/)[0]
          current.built = ['yes', 'partly'].includes(word) ? word : 'no'
        } else if (key === 'point') current.points.push(value.trim())
      } else if (kind === 'milestone') {
        if (key === 'change') current.change = changeOf(value)
        else if (key === 'cause') current.cause = value.trim()
      } else if (kind === 'goal') {
        if (key === 'state') {
          // "agreed (you, <date>; in the goal map)" is the partner's word for a goal confirmed and put in the map;
          // "not now (you, <date>)" your Not now (2026-10-24).
          current.state = /^(confirmed|agreed)\b/i.test(value.trim()) ? 'confirmed' : /^not now\b/i.test(value.trim()) ? 'later' : 'proposed'
          const { by, at } = sourceOf(value)
          Object.assign(current, { by, at })
        } else if (key === 'done when') { current.doneWhen = value.trim(); field = 'doneWhen' }
        else if (key === 'serves') current.serves = value.split(',').map(one => one.trim()).filter(one => /^P\d+$/.test(one))
        else if (key === 'sub') current.subs.push(value.trim())
        // The plan check (2026-10-21): why the partner proposed this goal ("F7 had no goal").
        else if (key === 'why') current.why = value.trim()
        else if (key === 'goal') current.goal = /^G\d+$/.test(value.trim()) ? value.trim() : null
        // 2026-10-24: a plan change: what it does to the goal map, why, and where the goal's steps go.
        else if (key === 'change') current.change = changeOf(value)
        else if (key === 'cause') current.cause = value.trim()
        else if (key === 'steps') current.steps = value.trim()
      }
      continue
    }
    // An indented continuation of an Answer, Known, Advice, Done when or a standard's long line; a bar point's
    // continuation may carry its picture (a line the partner wrapped).
    // A bar point's sub-points (the user, 2026-10-20: "use sub-bullets like I did, it reads easier"): indented "- "
    // lines under it, each a point of level 1 with its own picture where it has one.
    if (field === 'bar' && /^\s+-\s+\S/.test(raw)) {
      current.bar.push('')
      current.barLevels.push(1)
      setBar(current, raw.trim().replace(/^-\s+/, ''))
    } else if (field === 'bar' && /^\s+\S/.test(raw)) setBar(current, raw.trim())
    else if (field !== null && /^\s+\S/.test(raw)) current[field] = `${current[field]} ${raw.trim()}`.trim()
  }
  return { pitch, answers, features, milestones, standards, log, check, nextFocus, strategy, strategyAdvice }
}

const CHANGES = ['new', 'keep', 'move', 'merge', 'split', 'drop', 'rename']

/** A "- Change:" line: its kind (new, keep, move, merge, split, drop, rename, or other) and the rest of its words. */
export function changeOf(value) {
  const words = String(value ?? '').trim()
  const [first = '', ...rest] = words.split(/\s+/)
  const kind = first.toLowerCase()
  return CHANGES.includes(kind) ? { kind, text: rest.join(' ') } : { kind: 'other', text: words }
}

/** An ask's title that names a part of the plan: "P5: ...", a deeper "P1.2: ...", a feature "F7: ...", a goal "S3: ...", a standard "K2: ...". */
const QUESTION = /^(P\d+(?:\.\d+)?|F\d+|S\d+|K\d+)\b\s*[:·-]?\s*/

/** A partner's open ask on the plan as a slide's question: its options as cards, its pictures one per option or above. */
function questionOf(ask) {
  const title = String(valueOf(ask, 'Title') ?? '')
  const id = title.match(QUESTION)[1]
  const advice = valueOf(ask, 'Advice')
  const options = String(valueOf(ask, 'Options') ?? '').split(' | ').map(one => one.trim()).filter(Boolean)
  const pictures = String(valueOf(ask, 'Pictures') ?? '').split(',').map(one => one.trim()).filter(Boolean)
  const perOption = options.length > 0 && pictures.length === options.length
  return {
    id,
    // The answer, feature or goal it is about: "P1" for a deeper "P1.2".
    about: id.split('.')[0],
    isDeeper: id.includes('.'),
    askId: valueOf(ask, 'Id'),
    // When it was filed: a word to the partner asking for it is answered by a question filed after the word.
    filedAt: askFiledMs(ask),
    // The question: the title after its id.
    question: capital(title.replace(QUESTION, '').trim()),
    // An ask's words stand in its Text section; its title is the head's.
    text: (ask.sections?.get('Text') ?? []).join(' ').replace(/\s+/g, ' ').trim(),
    advice: advice === null || advice === '' ? null : String(advice),
    options: options.map((label, index) => ({ label, ...optionCard(label), isAdvised: isAdvised(label, advice), picture: perOption ? pictures[index] : null })),
    pictures: perOption ? [] : pictures,
  }
}

/**
 * The Vision tab's state: the parsed page with the partner's open asks on it as questions, in the page's order (the
 * answers and their deeper questions, then the features, then the goals), each answer with its own question (`ask`)
 * and the number of deeper ones (`deeper`); the counts of answers and of features by mark; and the architecture check:
 * a complex feature not marked must or no (later, or unsure) means the structure is checked again at every milestone,
 * else only when a complex feature comes. `items` are the store's items (work/read.mjs); `path` is the page's path in
 * the game, for the link. Null without a page.
 */
export function planState(text, items, path) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const { pitch, answers, features, milestones, standards, log, check, nextFocus, strategy, strategyAdvice } = parsePlan(text)
  const asked = (items ?? [])
    .filter(item => valueOf(item, 'Kind') === 'ask' && valueOf(item, 'State') === 'open' && QUESTION.test(String(valueOf(item, 'Title') ?? '')))
    .map(questionOf)
  const order = [...answers.map(one => one.id), ...features.map(one => one.id), ...milestones.flatMap(one => one.goals.map(goal => goal.id)), ...standards.map(one => one.id)]
  const place = question => {
    const at = order.indexOf(question.about)
    return (at < 0 ? order.length : at) * 1000 + (question.isDeeper ? Number(question.id.split('.')[1]) : 0)
  }
  const questions = asked.sort((a, b) => place(a) - place(b))
  const counts = { decided: 0, assumed: 0, open: 0 }
  for (const answer of answers) {
    counts[answer.state] += 1
    answer.ask = questions.find(question => question.id === answer.id) ?? null
    answer.deeper = questions.filter(question => question.about === answer.id && question.isDeeper).length
  }
  const marks = { must: 0, later: 0, no: 0, unsure: 0 }
  for (const feature of features) marks[feature.mark] = (marks[feature.mark] ?? 0) + 1
  const open = features.filter(feature => feature.isComplex && (feature.mark === 'later' || feature.mark === 'unsure'))
  // Tradeoffs (2026-10-21): every complex feature later or not sure, and those still without the person's choice.
  const tradeoffs = { total: open.length, open: open.filter(feature => feature.tradeoff === null).map(feature => feature.id) }
  const architecture = features.length === 0 ? null : {
    everyMilestone: open.length > 0,
    complex: features.filter(feature => feature.isComplex).map(feature => feature.id),
    open: open.map(feature => feature.id),
  }
  const goals = milestones.flatMap(one => one.goals)
  return {
    path, pitch, answers, counts, questions, features, marks, architecture, milestones,
    preset: { total: goals.length, confirmed: goals.filter(goal => goal.state === 'confirmed').length },
    // Standards (2026-10-20): per kind of thing the goals need, the bar, the foundation first, and today's gap.
    standards,
    bars: { total: standards.length, confirmed: standards.filter(one => one.state === 'confirmed').length, gaps: standards.filter(one => one.gap !== '').length },
    log: { hits: log.hits, gaps: log.gaps, overturned: log.overturned },
    // The new order (2026-10-21): the partner's last plan check, and the next focus it proposes (null: none).
    check, nextFocus, tradeoffs,
    // 2026-10-24: the strategy the plan is laid in (null: not chosen yet), and the partner's advice for it.
    strategy, strategyAdvice,
  }
}

/** What a word to the partner about the plan asks of it, for the Vision tab's line "Your partner is preparing ...". */
const WORK_WORDS = {
  'plan-deeper': 'deeper questions', 'plan-ask': 'the options', 'plan-marks': 'your marks', 'plan-feature-add': 'your new feature',
  'plan-goals-confirm': 'your confirmed goals', 'plan-goals-change': 'a changed preset', 'plan-goals-agree': 'the goals into your goal map',
  'plan-change': 'your change', 'plan-confirm': 'your confirm',
  'plan-settled': 'your good enough', 'plan-standards': 'the standards', 'plan-standards-confirm': 'your confirmed standards',
  'plan-standards-change': 'the changed standards', 'plan-standards-agree': 'the gaps into goals', 'plan-measure': 'the measure of today',
  // The new order (2026-10-21): the plan check, and a proposed next focus.
  'plan-check': 'the plan check', 'plan-focus': 'a next focus',
  'plan-tradeoffs': 'the tradeoffs', 'plan-tradeoff': 'your tradeoff',
  // 2026-10-24: the person's answer of a plan question, from which the partner prepares the card's next question.
  'plan-answer': 'the next question from your answer',
  // 2026-10-24: the plan laid in the strategy you chose; a goal or milestone you set aside for now.
  'plan-strategy': 'the plan in your strategy', 'plan-not-now': 'your not now',
}

/** The card a word answers ("P1" for an answer of "P1.2: ..."), when it is the person's answer of a plan question. */
const answeredCard = message => (typeof message?.ask === 'string' && (message.command ?? null) === null && QUESTION.test(String(message.title ?? ''))
  ? String(message.title).match(QUESTION)[1].split('.')[0] : null)
/** A word the partner has not answered after this long is late: the tab offers to send it again. */
export const PLAN_LATE_MS = 30 * 60_000

/**
 * Vision (2026-10-19): the plan's state with `working`: what the partner is preparing from the person's words on the
 * Vision tab (the board's own outbox, `sent`), newest first, one per word and part. A word is done once its answer is
 * there: for Go deeper a deeper question about the card filed after the word, for Get options its question, for every
 * word the plan's page written after it (`pageAt`). Not done: `waiting` (not with the partner yet), `working` (typed
 * into its chat), `late` (no answer after PLAN_LATE_MS), or `failed` (the word never arrived).
 */
export function withPlanWork(plan, sent, pageAt, now) {
  if (plan === null) return null
  const seen = new Set()
  const working = []
  for (const message of [...(Array.isArray(sent) ? sent : [])].reverse()) {
    const card = answeredCard(message)
    const command = card === null ? message?.command : 'plan-answer'
    if (typeof command !== 'string' || WORK_WORDS[command] === undefined) continue
    const about = card ?? message.about ?? 'plan'
    const key = `${command}:${about}`
    if (seen.has(key)) continue
    seen.add(key)
    const at = Number(message.at)
    const asked = command === 'plan-deeper'
      ? plan.questions.some(question => question.about === about && question.isDeeper && question.filedAt >= at)
      : command === 'plan-ask' ? plan.questions.some(question => question.id === about && question.filedAt >= at)
        : command === 'plan-answer' ? plan.questions.some(question => question.about === about && question.filedAt >= at) : false
    if (asked || (Number.isFinite(pageAt) && pageAt > at)) continue
    working.push({ command, about, at, state: wordState(message, at, now), what: WORK_WORDS[command] })
  }
  return { ...plan, working }
}

/** Where a word to the partner is: `waiting`, `working`, `late` (after PLAN_LATE_MS) or `failed`. */
const wordState = (message, at, now) => (message.state === 'expired' || message.state === 'failed' ? 'failed'
  : message.state === 'waiting' || message.state === 'held' ? 'waiting'
    : now - at > PLAN_LATE_MS ? 'late' : 'working')

/** A start the partner has not answered after this long no longer shows: the empty tab offers the start again. */
const START_SHOWN_MS = 24 * 60 * 60_000

/**
 * The empty Vision tab's wait (2026-10-24, the user: "i want a loader while im waiting for the partner"): the newest
 * start word in the board's outbox (`sent`), `{ at, state }` as withPlanWork's, for the tab while there is no plan page
 * yet; null without one, or a day after it was sent.
 */
export function planStarting(sent, now) {
  const start = (Array.isArray(sent) ? sent : []).findLast(message => message?.command === 'plan-start')
  if (start === undefined) return null
  const at = Number(start.at)
  if (!Number.isFinite(at) || now - at > START_SHOWN_MS) return null
  return { at, state: wordState(start, at, now) }
}
