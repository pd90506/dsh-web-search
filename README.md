# @pd90506/dsh-web-search

DSH plugin that adds **Brave Search** and **Tavily** as web search providers (alongside the
built-in `deepseek-official`), with a **Brave & Tavily** card under
**Settings → Plugins → Plugin configuration** for API keys and the default provider.

## Install

```bash
# Pin a commit so a later push cannot change the code run at install time
dsh plugin --profile web add github:pd90506/dsh-web-search#<commit-sha>
```

The first `add` fails: pnpm ≥10 blocks a git dependency's build scripts until allowed. Add the
exact key pnpm prints to the profile's `pnpm-workspace.yaml`, then re-run the `add`:

```yaml
# ~/.dsh/profiles/web/pnpm-workspace.yaml
allowBuilds:
  "@pd90506/dsh-web-search@https://codeload.github.com/pd90506/dsh-web-search/tar.gz/<commit-sha>": true
```

This lets the package's `prepare` script build the client bundle on your machine at install time
(outside any agent sandbox) — only allow sources you trust.

**Restart dsh once** after installing.

## Use

Open **Settings → Plugins → Plugin configuration → Brave & Tavily**: enter your Brave / Tavily
API keys and pick the default provider. Changes apply within about a second. Keys are stored in
`~/.dsh/.credentials.yaml` (mode 0600) and never echoed back.

Until you pick one, searches keep using the built-in `deepseek-official` provider.

## Development

```bash
npm install     # prepare builds lib/client.js
npm test        # real-API smoke test; needs BRAVE_API_KEY / TAVILY_API_KEY in .env
```

Host-side changes (`src/*.js`) require a dsh restart; client changes (`src/client/`) hot-reload
after `npm run build` when the plugin is installed as a `link:`.
