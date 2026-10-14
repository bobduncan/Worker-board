# The board on a phone (B192)

An analysis; nothing is built. The person, 2026-10-14: "i want to redesign the workers board to make it mobile
friendly. on the backlog to analyse". Checked on the demo data (`npm run demo`) at 375 px wide.

## What breaks today

- **The page is about 760 px wide on a phone.** A phone then shrinks the whole page or scrolls it sideways. Two
  parts cause it: the top bar (the tabs, "Prepare restart", the version and "Last updated" in one row that does not
  wrap) and the limits box (the 5-hour limit and the week side by side, at fixed widths).
- **Windows open half off the screen**, because they are centred on that 760 px page.
- **Needs your attention is at the very bottom.** Under 1250 px everything stacks: the head, the Workers panel, the
  timeline, the folders, and only then the cards the person acts on, about 3000 px down.
- **Most parts already fit** once the width is right: the cards (Approve and Reject, the options, the answer box),
  the Workers panel's narrow layout (only its time column is tight: "Blocked" and "Available" are cut), the Backlog
  list's narrow layout (id, title, state), Talk to Main (one column).
- **Desktop parts by nature:** the Design tab (pictures side by side, references), the timeline, the resizers, the
  two columns of Advice & Chat.

Pictures: `b192/2026-10-14-b192-phone-today.png` and `b192/2026-10-14-b192-phone-proposal.png` in the project's
picture folder for the board (the first project keeps them in `art-inbox/worker-board/`).

## What the person does on a phone

- Answer and approve: Needs your attention and its windows. This is the reason to have it on the phone.
- Talk to the main chat: give a task, answer it.
- Follow the workers: who works on what, the time left, who waits.
- Glance at the backlog's recently finished steps.

Can stay on the desktop: the Design tab, the timeline, adding and removing workers, "Prepare restart", and "Run
game" / "Play it" (the game runs on the PC at 127.0.0.1; a phone cannot open it).

## How a phone reaches the board

Today the board listens on 127.0.0.1 only, and takes a click only from a page whose origin is
`http://127.0.0.1:<port>`. Its token is written into the page for whoever loads it: it stops other websites, it is
not a login. So every way in below needs a login on the board first.

1. **The chats themselves, from the Claude app on the phone (Remote Control).** Works today, nothing to build, behind
   the person's own account. The board's overview and windows are not there.
2. **A private network of the person's own devices (for example Tailscale or WireGuard). Advised.** The board also
   listens on the PC's address in that network; only the person's devices reach it, from anywhere. Needs: a login
   (a pairing code shown on the PC's board, then a cookie on the phone), the origin check for that address, and the
   game links hidden on the phone.
3. **The home Wi-Fi.** The board listens on the PC's address in the home network. Only at home; everyone on that
   Wi-Fi can load the page, and without HTTPS what is typed travels in the clear. Only with a login and a trusted
   Wi-Fi.
4. **A public tunnel (for example Cloudflare Tunnel).** A web address that works anywhere, with HTTPS. It must sit
   behind the tunnel's own login, or anyone with the address types into the chats. The most risk and the most setup.

Whichever way: the address the board listens on becomes a setting (`config.json`, 127.0.0.1 when empty), never all
addresses by default.

## Proposal, in pieces that each merge on their own

The sizes are working time as the board measures it (B185): board tasks typically take 5 to 15 minutes of work.

1. **Fit the width** (about 20 min). The top bar wraps (the tabs scroll sideways; the version and "Last updated" move
   to a line of their own), the limits box stacks, the time column of a worker gets room, and under 600 px a window
   fills the screen with its Send row kept at the bottom (picture 3 of the proposal). After this every part works on
   a phone and nothing is cut off.
2. **Phone order** (about 20 min). Under 600 px: Needs your attention first, then the workers; the timeline and the
   folders folded away; the tabs as a bar at the bottom ("Today", "Advisor", "Backlog"), the Design tab left out
   (pictures 1 and 2).
3. **Thumbs** (about 10 min). Buttons at least 44 px high, the answer box grows as one types, a picture opens the full
   width of the screen and can be pinched.
4. **Reach it from the phone** (about 1 h, after the person chose a way). The address setting, the login (pairing
   code and cookie), the origin check per allowed address, the game links hidden when the page is not on the PC.
5. **With B195**: the Advisor tab's milestone flow drawn top to bottom on a phone.

Pieces 1 to 3 are layout only (the style sheet and a little page script) and add no tie to any project; piece 4
adds settings to `config.json`, with the defaults as today.
