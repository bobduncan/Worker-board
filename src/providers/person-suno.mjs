// The asset provider for music: the person, who makes it in Suno (mode "person"). It is always there; part 2 turns a
// request into an ask for the person, with the folder to drop the file in.

export const personSuno = {
  name: 'person-suno',
  mode: 'person',
  kinds: ['music'],
  /** Always ok: the person is the provider. */
  check() {
    return { ok: true, why: 'you make it in Suno' }
  },
}
