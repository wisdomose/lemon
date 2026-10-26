# Lemon

A desktop design tool where AI agents and people design together on one infinite canvas. Agents run on
your own computer with your own AI subscription (Claude or Codex); nothing runs on our servers.

**Status:** early proof of the engine — document, layout, drawing and the agent's tool. Not usable yet.

## How it fits together

| Part | Folder | What it does |
|---|---|---|
| Document | `src/doc` | Flat records in Yjs so people and agents can edit at the same time; read as a tree. |
| Layout | `src/layout` | Yoga (single-axis flexbox) positions every node; the automatic check finds clipped, overflowing, cut-off or low-contrast content by measuring. |
| Text | `src/text` | Fonts from Google Fonts; text measured and drawn by the same CanvasKit paragraphs. |
| Drawing | `src/render` | CanvasKit (Skia) draws the canvas and the agent's screenshots. |
| Sandbox | `src/sandbox` | QuickJS (WebAssembly) runs the agent's scripts with no access to the computer. |
| Agent | `src/agent` | The Claude Agent SDK with one tool, `execute`: a script against the document, all-or-nothing. |

The product name lives in one place: `product.json`.

## Development

```sh
pnpm install
pnpm test          # engine tests (downloads fonts into .cache/ the first time)
pnpm typecheck
npx tsx scripts/proof.ts --name landing --prompt "A landing page for a coffee shop in Lisbon"
```

The proof script needs Claude Code installed and signed in (`claude auth status`).

### Running the app from source

```sh
pnpm dev     # the app, live: the window updates on save; Electron restarts when the main process changes
pnpm build   # build into out/
pnpm start   # run the built app
```

Optional developer settings (logging, opening a file, …) go in a `.env` file; `.env.example` lists them.
`.env` is read only when running from source. On Linux machines where Chromium's sandbox won't start,
use `pnpm dev --noSandbox`.

### Codex provider

Install Codex CLI (0.160.0 or newer) and run `codex login`. In Lemon, select **Codex (default)**
from the OpenAI model group, or choose an individual model discovered from your local Codex catalog.
The picker refreshes whenever opened, keeps cached choices during loading, and offers retry after a
failure. Selecting a discovered model also offers its supported reasoning efforts. Model and effort
choices follow prompts from the Dashboard into editor windows and team runs. The default fallback
uses your configured Codex model. Lemon uses your existing login without reading credentials. Settings → Agents shows connection status.

Codex supports canvas scripts, screenshots, failed-script repairs, streamed chat replies, Stop, and
both team modes. Canvas changes appear when each complete tool call arrives; Claude also previews
scripts while their arguments stream. Codex subscription runs report tokens, without a dollar cost.

The integration uses the local [Codex app server](https://learn.chatgpt.com/docs/app-server) and its
experimental dynamic-tool API. Missing CLI, authentication, model-access, and rate-limit errors appear
in chat. Team planning follows the selected provider.
