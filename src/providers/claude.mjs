// Claude as a source of pictures, shown greyed on the visual row and never chosen: it draws in code, so simple shapes only,
// which units and maps are not. It serves NO kind (`kinds` is empty), so the settings refuse it (src/config.mjs readProviders);
// `shownFor` is only for the page's card. It has no
// `provide` (part C): nothing is ever asked of it.

export const claude = {
  name: 'claude',
  mode: 'auto',
  kinds: [],
  shownFor: ['visual'],
  card: { title: 'Claude', line: 'Draws in code: simple shapes only', facts: ['Not for units or maps'], icon: 'claude' },
  /** Never works for a kind: it is only shown. */
  check() {
    return { ok: false, state: 'off', why: 'Not for this kind', detail: '' }
  },
}
