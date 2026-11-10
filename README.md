# dsh-wps-office

DeepSeek Harness (DSH) bundle that lets the agent drive **WPS Office** — Excel,
Word and PPT — through five compact facade tools, and ships the four upstream
WPS skills.

The bundled MCP server ([lc2panda/wps-skills](https://github.com/lc2panda/wps-skills),
MIT) advertises **250 tools**. Registering all of them would cost tens of
thousands of prompt tokens every turn, so this plugin keeps them behind a
small, stable surface and exposes them on demand:

| Tool | Purpose |
| --- | --- |
| `wps_excel` | `{ method, args }` → any `wps_excel_*` MCP tool |
| `wps_word` | `{ method, args }` → any `wps_word_*` MCP tool |
| `wps_ppt` | `{ method, args }` → any `wps_ppt_*` MCP tool |
| `wps_office` | `{ method, args }` → the 21 general tools (`check_connection`, `execute_method`, `convert_to_pdf`, …) |
| `wps_help` | connection status; list methods per app; full argument schema for one method |

Plus four skills registered per agent: `wps-excel`, `wps-word`, `wps-ppt`,
`wps-office`. Their bodies are the upstream guidance, rewritten from raw MCP tool
names into the facade form (`wps_excel_generate_formula(args)` becomes
`wps_excel({ method: "generate_formula", args })`), with a short header stating
the convention. `scripts/rewrite-skill-tools.mjs` regenerates that rewrite from
upstream skill text and is idempotent.

## Verified on this machine

- `wps_help` reports `MCP server 已连接` and `excel 82 / word 32 / ppt 115 / office 21（共 250）`.
- All five facade tools answer without error; `wps_common_wire_check` returns
  `通信线路正常！WPS MCP Bridge 已连接`, so on Windows the COM layer works
  without a separate WPS add-in install.
- The four skills resolve to the plugin copies (base directory is this package's
  `skill/`), so a same-named skill in `~/.agents/skills` does not duplicate the
  catalog entry.
- Context cost: the five facade schemas are ~2.6 KB of JSON (~0.9 K tokens),
  versus ~109 KB of JSON schema for the 250 raw MCP tools.

## Install

From a local checkout (development):

```sh
dsh plugin --profile desktop add link:D:/Coding/dsh-wps-office
```

From GitHub (pnpm installs the declared dependencies, the built server is
committed under `vendor/`):

```sh
dsh plugin --profile desktop add github:fuqiang-lab/dsh-wps-office
```

From npm (once published), or through a custom plugin index:

```sh
dsh plugin --profile desktop add dsh-wps-office
```

The profile must be restarted (or the plugin row hot-loaded) after installing.

## Requirements

- Windows with WPS Office installed (`wps-excel`/`wps-word`/`wps-ppt` style
  COM automation).
- The WPS add-in from the upstream repository must be installed once, with
  elevation, then WPS restarted:
  `powershell -ExecutionPolicy Bypass -File vendor/wps-office-mcp/scripts/install.ps1`
  (on macOS/Linux use the corresponding upstream script). This step needs UAC
  and cannot be silently automated by the plugin.
- Node.js 22.19+ / 24+. The plugin prefers the Node runtime bundled with the
  desktop app and falls back to `node` on `PATH`.

## Configuration

Row config in `cordis.patch.yml` (all optional):

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Load the plugin rows at all |
| `eagerConnect` | `true` | Spawn the MCP server at activation instead of first call |
| `skillNote` | `true` | Prepend the facade-convention header to skill bodies |
| `connectTimeoutMs` | `20000` | Handshake / `tools/list` timeout |
| `requestTimeoutMs` | `120000` | Per `tools/call` timeout |
| `command` / `args` / `cwd` / `env` | bundled server | Override the spawned process |

## Repository layout

```
lib/index.mjs                     plugin entry, facade tools, skill registration
cordis.patch.yml                  bundle layer (one insert row)
skill/{wps-excel,wps-word,wps-ppt,wps-office}/SKILL.md
vendor/wps-office-mcp/dist        built upstream MCP server
vendor/wps-office-mcp/scripts     wps-com.ps1 (Windows COM layer)
scripts/smoke.mjs                 host-free smoke test (node scripts/smoke.mjs)
scripts/rewrite-skill-tools.mjs   re-apply the facade rewrite to upstream skill text
```

The vendored server is a build artifact of upstream `wps-office-mcp`. To refresh
it: clone `lc2panda/wps-skills`, run `npm install && npm run build` in
`wps-office-mcp`, then copy `dist/`, `scripts/` and `package.json` over
`vendor/wps-office-mcp/`. Its runtime dependencies (`@modelcontextprotocol/sdk`,
`axios`, `uuid`, `winston`) are declared in this package's `dependencies`, so
`node_modules` need not be vendored.

## Notes

- The skills are registered per agent, so they win over same-named filesystem
  skills in `~/.agents/skills` (install the upstream skills there only if you
  also use other agents).
- Refreshing the vendored server or skills: copy the new upstream files in, then
  run `node scripts/rewrite-skill-tools.mjs` (it is idempotent and reports any
  call it cannot map) before reinstalling/restarting the profile.
- Tool calls are marked not concurrency-safe: WPS COM automation is serial.
- A failed MCP handshake never fails plugin activation; the next call retries
  and `wps_help` reports the connection state.

## License

MIT. Vendored `wps-office-mcp` and the four skills come from
[lc2panda/wps-skills](https://github.com/lc2panda/wps-skills) (MIT).
