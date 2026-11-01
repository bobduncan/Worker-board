// The asset provider for music: the person, who makes it in Suno (mode "person"). It is always there; part 2 turns a
// request into an ask for the person, with the folder to drop the file in.

export const personSuno = {
  name: 'person-suno',
  mode: 'person',
  kinds: ['music'],
  card: { title: 'Suno, by hand', line: 'You make it in Suno; the board asks you', facts: ['No automatic link exists', 'Your Suno plan'], icon: 'suno' },
  /** Always ok: the person is the provider. */
  check() {
    return { ok: true, state: 'works', why: 'you make it in Suno', detail: 'asks you for a file' }
  },
}
