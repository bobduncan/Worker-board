// B354: the project's kinds of work, as the board's settings name them (`kinds`: each kind's name, its definition of
// done and its reference folder), and a step's Standard line: "<kind> · <reference picture> · target <score>", or
// "none (<why>)". The board knows no kind of its own: every name comes from the settings.

const SEP = ' · '
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A kind's name as whole words in a text, in any case, its last word also in the plural (s, es; a y after a consonant
 * as ies). The review: not inside a compound or a path ("high-level", "art/levels/"), so a hyphen or a slash beside
 * it is no word's end.
 */
function namePattern(kind) {
  const words = kind.trim().split(/\s+/)
  const last = words.pop()
  const plural = /[^aeiou]y$/i.test(last) ? `${escape(last.slice(0, -1))}(?:y|ies)` : `${escape(last)}(?:s|es)?`
  return new RegExp(`(?<![A-Za-z0-9/.-])${[...words.map(escape), plural].join('[\\s-]+')}(?![A-Za-z0-9/-]|\\.\\w)`, 'i')
}

/** The kinds of the settings (`kinds`) a text names, in the settings' order. */
export function kindsNamed(text, kinds) {
  const words = String(text ?? '')
  return (Array.isArray(kinds) ? kinds : []).filter(one => typeof one?.kind === 'string' && one.kind.trim() !== '' && namePattern(one.kind).test(words))
}

/**
 * A step's standard as given (`standard` of the work tool): `{ ok: true, kind, line }`, the kind as the settings write
 * it (null for none), or `{ ok: false, why }`. With no kinds in the settings any kind's name is taken as written.
 */
export function parseStandard(value, kinds) {
  const words = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (words === '') return { ok: false, why: 'Give the standard: "<kind> · <reference picture> · target <score>", or "none (<why>)".' }
  if (/^none\b/i.test(words)) {
    const why = words.match(/^none\s*\((.+)\)$/i)?.[1].trim() ?? ''
    return why === '' ? { ok: false, why: 'Say why there is no standard: "none (<why>)".' } : { ok: true, kind: null, line: `none (${why})` }
  }
  const [kind = '', picture = '', target = '', ...more] = words.split(/\s*·\s*/).map(part => part.trim())
  const known = (Array.isArray(kinds) ? kinds : []).filter(one => typeof one?.kind === 'string')
  const found = known.find(one => one.kind.toLowerCase() === kind.toLowerCase())
  if (known.length > 0 && found === undefined) return { ok: false, why: `"${kind}" is no kind of the settings: ${known.map(one => one.kind).join(', ')}.` }
  if (kind === '') return { ok: false, why: 'Name the kind first: "<kind> · <reference picture> · target <score>".' }
  if (picture === '' || /^target\b/i.test(picture)) return { ok: false, why: 'Name the reference picture: "<kind> · <reference picture> · target <score>".' }
  if (!/^target\s+\S/i.test(target) || more.length > 0) return { ok: false, why: 'End with the target score: "<kind> · <reference picture> · target <score>".' }
  const name = found?.kind ?? kind
  return { ok: true, kind: name, line: [name, picture, target.replace(/^target\s+/i, 'target ')].join(SEP) }
}

/** A step's standard: its Standard section, else its refine block's Standard line; null when it has none. */
export function standardOf(item) {
  const own = (item?.sections?.get('Standard') ?? []).map(one => one.trim()).find(Boolean)
  if (own !== undefined) return own
  const line = (item?.sections?.get('Refined') ?? []).map(one => one.trim()).find(one => /^Standard:\s*\S/.test(one))
  return line === undefined ? null : line.replace(/^Standard:\s*/, '')
}

/**
 * Why a step that names a kind of the settings (`named`, kindsNamed) cannot be ready without its standard: the kind,
 * the form with its reference folder, and its definition of done. `who` is the step's id, or "This step".
 */
export function standardWanted(who, named) {
  const first = named[0]
  const names = named.map(one => `"${one.kind}"`).join(', ')
  return `${who} names the kind${named.length > 1 ? 's' : ''} of work ${names}: give its standard in "standard" (or as a line of "what" that starts with "Standard:"), as "${first.kind} · <a reference picture from ${first.reference}> · target <score>" (checked against ${first.done}), or "none (<why>)" when it makes no ${first.kind}.`
}
