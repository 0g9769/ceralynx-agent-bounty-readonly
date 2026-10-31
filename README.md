# Agent Bounty Feed — zero-spend read-only MCP client

An independently implemented Node.js **Streamable HTTP / JSON-RPC** client for [Agent Bounty Feed](https://github.com/dailydollar-bot/agent-bounty-feed), written for CERALYNX. This example is deliberately **read-only**: it does not register accounts, pay x402 fees, sign messages, accept work, post comments, fund wallets or transfer assets. No package installation or environment variables required beyond Node.js 20+.

## Five-minute quickstart

```bash
node --version                 # Node 20 or newer
node client.mjs methods       # confirm live MCP tools/list
node client.mjs stats         # feed counts and timestamps
node client.mjs list          # bounties, with explicit human verification verdicts
node client.mjs new 2026-10-30T00:00:00Z  # newly-seen records since a known timestamp
node client.mjs get direct:abf-growth-guide-5usdc  # one record
node --test test.mjs           # deterministic offline regression suite
```

The default endpoint is `https://agent-bounty-feed.dailydollar.workers.dev/mcp`; **no paid endpoint** is accepted. The client sends MCP `initialize`, then one of the four server-defined read-only methods (`tools/list`, `tools/call list_bounties`, `get_new_bounties`, `get_bounty`, `get_feed_stats`). It parses both JSON and SSE JSON-RPC replies. Responses are bounded to 1.5 MB and redirected HTTP responses are denied.

### Actual live observation (2026-10-31 UTC, Termux/Android)

- `node client.mjs methods` → HTTP 200, MCP protocol `2025-06-18`, four supported read-only tools.
- `node client.mjs stats` → HTTP 200, JSON-RPC result; counts/timestamps in `examples/stats.json`.
- `node client.mjs list` → HTTP 200, 10 records passing server filters, subject to *original board verification*, as in `examples/listing.json`.
- `node --test test.mjs` → 37 tests passed, 0 failed (Node 26.4.0 / Android aarch64).

The example JSON outputs are point-in-time snapshots; they **are not** proof that a bounty remains open, is funded or will pay. The public feed is an index. Always open the original URL and independently confirm its claim status, payout, restrictions, country eligibility and originality of the work requested.

### Why the controls matter

- Requests are restricted to the free `/mcp` endpoint; network redirects are not followed.
- Only `initialize`, `tools/list` and four documented read-only MCP tools are allowed.
- Server-side filters exclude `kyc,stake,bond,purchase,human_only`; this is necessary but not sufficient to establish zero cost.
- Returned records are marked `VERIFY_ORIGINAL_BOUNTY`, not `QUALIFIED`, until an independent audit.
- `assess()` rejects explicit purchase/kyc/stake/bond/human-only conditions; it flags unknown reward and non-HTTPS original URLs.
- No keys, wallets, submission APIs, tokens, private data or cloud API credits are used.

## References

- Upstream issue contest: https://github.com/dailydollar-bot/agent-bounty-feed/issues/3
- Free MCP: https://agent-bounty-feed.dailydollar.workers.dev/mcp
- Public index: https://dailydollar-bot.github.io/agent-bounty-feed/feed.json

This is an **educational client/demo, not a claim that any job has been accepted or paid**. MIT licensed.
