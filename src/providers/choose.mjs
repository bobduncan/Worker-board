// Choosing a provider (spec 2026-11-01-asset-providers-screens-design.md, part A): what the Settings tab shows for each kind
// and when a provider may be switched to. Pure: no server, no files; the checks it reads are kept by the board in a Map
// keyed `${kind}|${name}` (see `checkKey`), each `{ state, ok, why, detail, at }`.
//
// The rule of the spec: a provider is used only after its Verify passed, and a pass counts for a few minutes, so a switch
// is never made on an old answer.

import { ASSET_KINDS, PROVIDERS, providerFor, runCheck } from './index.mjs'

/** How long a passed Verify counts for a switch: 10 minutes. */
export const VERIFY_FRESH_MS = 10 * 60_000

/** The key a check is kept under: the kind and the provider's name. */
export const checkKey = (kind, name) => `${kind}|${name}`

/** The providers shown on `kind`: the ones that serve it and the ones only shown there (`shownFor`), in PROVIDERS order. */
const shownOn = kind => Object.values(PROVIDERS).filter(one => one.kinds.includes(kind) || (one.shownFor ?? []).includes(kind))

/** A kept check as the page gets it, or null. */
const lastOf = (checks, kind, name) => {
  const kept = checks?.get?.(checkKey(kind, name))
  return kept === undefined || kept === null ? null : { state: kept.state, ok: kept.ok, why: kept.why, detail: kept.detail, at: kept.at }
}

/**
 * What the Settings tab shows: `[{ kind, inUse, cards: [{ name, mode, card, selectable, last }] }]` in the order of
 * ASSET_KINDS. `inUse` is the name of the provider the settings set for the kind (null when they name none the board
 * knows); the cards are the providers shown on the kind with the one in use first. `selectable` is false for a provider
 * that is only shown (claude); `last` is the kept check, or null when none was made yet.
 */
export function providerCards(settings, checks) {
  return ASSET_KINDS.map(kind => {
    const inUse = providerFor(settings, kind)?.provider.name ?? null
    const cards = shownOn(kind)
      .map(one => ({ name: one.name, mode: one.mode, card: one.card, selectable: one.kinds.includes(kind), last: lastOf(checks, kind, one.name) }))
      .sort((a, b) => Number(b.name === inUse) - Number(a.name === inUse))
    return { kind, inUse, cards }
  })
}

/**
 * Runs the check of provider `name` for `kind` now and returns the record to keep: `{ state, ok, why, detail, at }`.
 * The folder is the settings' when the provider is the one in use for the kind and has one, else the provider's own
 * default. `tools` is what the checks look with (`project`, `codexPath`, and the tests' stand-ins `findCodex`, `key`,
 * `fetch`); `tools.now` stands in for the clock. A name the board does not show on the kind is "off". It never throws.
 */
export async function verifyOne(settings, kind, name, tools = {}) {
  const { now = Date.now(), ...looks } = tools
  const provider = PROVIDERS[name]
  if (provider === undefined || !shownOn(kind).includes(provider)) {
    return { state: 'off', ok: false, why: `${String(name).slice(0, 40)} is not a provider the board shows for ${String(kind).slice(0, 20)}`, detail: '', at: now }
  }
  const set = providerFor(settings, kind)
  const folder = set !== null && set.provider === provider && set.folder !== null ? set.folder : provider.folder
  const checked = await runCheck(provider, { ...looks, ...(folder === undefined ? {} : { folder }) })
  return { ...checked, at: now }
}

/**
 * Whether the board may switch `kind` to provider `name`: `{ ok, why }`. Ok only when the provider serves the kind and its
 * kept check for that kind is "works" and at most VERIFY_FRESH_MS old at `now`. `why` says what is missing otherwise.
 */
export function mayUse(checks, kind, name, now = Date.now()) {
  const provider = PROVIDERS[name]
  if (!ASSET_KINDS.includes(kind)) return { ok: false, why: 'That is no kind of asset.' }
  if (provider === undefined) return { ok: false, why: 'The board does not know that provider.' }
  if (!provider.kinds.includes(kind)) return { ok: false, why: `${provider.card.title} does not serve ${kind}.` }
  const last = lastOf(checks, kind, name)
  if (last === null) return { ok: false, why: `Verify ${provider.card.title} first.` }
  if (last.state !== 'works') return { ok: false, why: last.why === '' ? `${provider.card.title} does not work yet.` : last.why }
  if (!(now - last.at <= VERIFY_FRESH_MS)) return { ok: false, why: `The Verify of ${provider.card.title} is more than 10 minutes old: verify it again.` }
  return { ok: true, why: '' }
}
