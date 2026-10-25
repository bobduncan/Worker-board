// The asset providers (T9.3, spec 2026-10-25-asset-providers-design.md, part 1): who provides each kind of asset.
// The setting is `providers` in config.json (src/config.mjs reads and refuses it); each provider is a small module of
// this folder with the same face, `{ name, mode, kinds, check }`:
//   name   the name the setting uses
//   mode   how it provides: "auto" (the board runs it), "person" (the person makes it), "pick" (a chat picks a file)
//   kinds  the asset kinds it can serve
//   check  `check(tools)` answers `{ ok, why }`: whether it can work now. It makes nothing and never throws.
// Part 2 adds `provide(request, tools)` to each module (and a call here that routes a request to the kind's provider);
// nothing asks a provider for an asset yet.

import { codex } from './codex.mjs'
import { personSuno } from './person-suno.mjs'
import { soundLibrary } from './sound-library.mjs'

/** The kinds of asset, in the order the page shows them. */
export const ASSET_KINDS = ['visual', 'music', 'sound effect']

/** The providers the board knows, by name (no prototype: a setting's "constructor" is no provider). */
export const PROVIDERS = Object.freeze(Object.assign(Object.create(null), Object.fromEntries([codex, personSuno, soundLibrary].map(one => [one.name, one]))))

/** The setting of each kind when `providers` does not name it: `{ provider, folder? }`. */
export const DEFAULT_PROVIDERS = Object.freeze({
  visual: Object.freeze({ provider: 'codex' }),
  music: Object.freeze({ provider: 'person-suno' }),
  'sound effect': Object.freeze({ provider: 'sound-library', folder: soundLibrary.folder }),
})

/**
 * The provider set for `kind` in the settings' `providers` (the board's config; the default where it names none):
 * `{ provider, folder }`, the provider's module and its folder (null for one that has none). Null when the setting
 * names no provider the board knows, which a settings file the board started on never does.
 */
export function providerFor(settings, kind) {
  const set = settings?.providers?.[kind] ?? DEFAULT_PROVIDERS[kind]
  const provider = PROVIDERS[set?.provider]
  return provider === undefined ? null : { provider, folder: set.folder ?? null }
}

/**
 * Whether the provider of each kind can work now: `[{ kind, provider, mode, ok, why }]`, in the order of ASSET_KINDS.
 * `tools` is what the checks look with: `project` (the project's folder), `codexPath` (the Design tab's `codex`
 * setting) and, for the tests, `findCodex`. It makes nothing; a provider's `check` never throws, so neither does this.
 */
export async function checkProviders(settings, tools = {}) {
  return Promise.all(ASSET_KINDS.map(async kind => {
    const found = providerFor(settings, kind)
    if (found === null) return { kind, provider: null, mode: null, ok: false, why: `No provider the board knows is set for ${kind}` }
    const { provider, folder } = found
    const checked = await provider.check({ ...tools, ...(folder === null ? {} : { folder }) })
    return { kind, provider: provider.name, mode: provider.mode, ok: checked.ok === true, why: String(checked.why ?? '') }
  }))
}
