# @pd90506/dsh-web-search

A DSH plugin that registers **Brave Search** and **Tavily** as web search providers on the
`ctx.web` seam (alongside the built-in `@deepseek-ai/dsh-web-search-deepseek`), plus a
**"Brave & Tavily"** configuration card under **Settings → Plugins → Plugin configuration**:
a default-provider dropdown and API key management for Brave / Tavily.

## Layout

```
├── cordis.patch.yml   bundle layer: inserts this plugin (`dsh plugin add` appends it to the profile's bundles)
├── src/index.js       host plugin entry: name/inject/Config/apply — registers both providers + mounts the settings RPC service
├── src/brave.js       BraveSearchProvider — GET {baseURL}/web/search (X-Subscription-Token)
├── src/tavily.js      TavilySearchProvider — POST {baseURL}/search (Authorization: Bearer), answer mapped to content
├── src/shared.js      shared helpers for cancellation/errors/credential resolution (same conventions as the deepseek provider)
├── src/host-gateway.js webSearch service: two strict typert endpoints, getState / setDefaultProvider
├── src/client/        configuration card source (React, registers the settings.plugin.item slot)
├── build.mjs          bundles the client into __ModuleLoader__ factory format → lib/client.js (same script as prepare, runs automatically on git installs)
└── test/smoke.mjs     real-API smoke test (reads .env in this directory)
```

Provider ids: `brave`, `tavily` (the built-in one is `deepseek-official`).

## How it works (facts aligned with the built-in provider)

- **Registration**: `ctx.web.registerSearchProvider(provider)`; the seam itself enforces `maxResults` truncation.
- **Credential chain**: literal `apiKey` → credentials service (`$DSH_HOME/.credentials.yaml`, mode 0600,
  hot-reloaded) → launch environment (process env > launch-directory `.env` > `$DSH_HOME/.env`).
  A missing key raises `WEB_PROVIDER_CREDENTIAL_MISSING`.
- **Provider selection**: the `web` entry's `searchProvider` config (with the `DSH_WEB_SEARCH_PROVIDER`
  environment variable as fallback). There is no fallback chain — each search goes through exactly one
  provider. The base layer defaults to `deepseek-official`; installing this plugin does not change that.
- **Default-provider dropdown**: writes to the profile's `~/.dsh/profiles/web/cordis.patch.yml`
  (`config.searchProvider` on the `- id: web` entry — merged in, preserving comments and sibling entries).
  That file is watched by HMR, so changes take effect within about a second and persist across restarts.
  No manual editing needed.
- **Settings-page RPC**: `webSearch/*` endpoints are registered as strict endpoints through the shared
  typert registry (`ctx.typert.register`) — runtime registration, unaffected by module-identity
  differences between the plugin's nested `@deepseek-ai/*` copies and the host's instances (the
  `@Remote` decorator path *is* affected — do not use it). Keys are read and written only through the
  official `credentials.*` RPC (loopback-only) and are never echoed back.

## Install (web profile, from GitHub)

```bash
# Pin to a commit so a later push cannot silently change the code that runs at install time
dsh plugin --profile web add github:pd90506/dsh-web-search#<commit-sha>
```

A git install fetches **sources, not built artifacts** (`lib/` is not committed). The package's
`prepare` script (`node build.mjs`) builds `lib/client.js` on the spot after install, with no
dev-only context such as a monorepo checkout required. pnpm ≥10 refuses to run a git dependency's
build scripts by default, so the first `add` fails with a prompt: add this package to the profile's
`pnpm-workspace.yaml` allowlist, then re-run `add`. Note the allowlist key is not the bare package
name — it is the full `name@tarball-URL` string pnpm prints (the commit sha is pinned inside the URL):

```yaml
# ~/.dsh/profiles/web/pnpm-workspace.yaml
allowBuilds:
  "@pd90506/dsh-web-search@https://codeload.github.com/pd90506/dsh-web-search/tar.gz/<commit-sha>": true
```

Warning: this allowlist means **allowing the package to execute code on your machine at install time**
(outside any agent sandbox) — only allow packages whose source you trust, and pin a commit (`#<sha>`).

**Restart dsh once** after installing (the client module manifest is only scanned at startup). From
then on, the default provider and keys in the **Settings → Plugins → Plugin configuration →
Brave & Tavily** card take effect immediately.

## Local development (link: install)

```bash
npm install                        # prepare builds lib/client.js automatically
dsh plugin --profile web add /path/to/dsh-web-search
# pnpm references this directory as link:; the dsh.bundle.patch declaration activates the bundle layer — no profile edits needed
```

- Editing `src/client/` → `npm run build` → hot reloads in the browser (client-hmr);
- editing `src/*.js` (host side) → restart dsh (dsh does not enable module-level HMR by default);
- publishing: after `git push`, users install from GitHub as above (a git install does not follow local changes).

## Configuration (optional)

The `config: {}` inserted by the bundle layer can be overridden (write it into the entry of the same
name in the profile's `cordis.patch.yml`; patch semantics replace the whole config block):

| Key | Default | Description |
| --- | --- | --- |
| `braveApiKey` / `tavilyApiKey` | — | literal key (secret; storing on disk not recommended) |
| `braveApiKeyEnv` / `tavilyApiKeyEnv` | `BRAVE_API_KEY` / `TAVILY_API_KEY` | credential reference name |
| `braveBaseURL` | `https://api.search.brave.com/res/v1` | API root |
| `tavilyBaseURL` | `https://api.tavily.com` | API root |
| `tavilySearchDepth` | `basic` | `basic`/`advanced` |
| `tavilyIncludeAnswer` | `true` | answer mapped to result `content` |
| `maxResults` | `10` | cap when the request carries no `maxResults` (Brave caps at 20) |

## Smoke test

```bash
npm install
echo 'BRAVE_API_KEY=...' >> .env
echo 'TAVILY_API_KEY=...' >> .env
npm test          # verifies the missing-key path first, then fires one real search per provider
```

## Notes

- `.credentials.yaml` must only be **merge**-written (preserve existing entries, mode 0600) — a
  wholesale overwrite wipes other keys (this was the root cause of this plugin's first incident).
  Use the settings page or the Models page for day-to-day key writes.
- The `webSearch/*` endpoints run through the typert gateway (trusted-host domain) and only expose
  provider state and default-provider writes — they never touch key material itself.
