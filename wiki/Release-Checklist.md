# Release checklist

Most of this is enforced by `npm test`. What is written here is the part a machine cannot decide.

The standing rule: **a platform change updates the API documentation in the same release.** The web front end and the native client are built in different places, and the only thing holding them in step is the written contract.

---

## What the tests already enforce

Run `npm test` and these fail the build on their own:

| Check | Catches |
|---|---|
| Route coverage | An endpoint reachable with an API key that is not in [API](API) |
| Session-only list | A route that refuses keys without saying so, or a list that has drifted from what the server enforces |
| Capability coverage | A flag in `/api/capabilities` that appears nowhere in the documentation |
| `apiVersion` agreement | The served version disagreeing with the documented one |
| **Surface manifest** | Any route added, removed or renamed, and any capability flag flipped |
| Release notes | `package.json` at a version with no entry in [What's New](Whats-New) |
| API impact statement | A CHANGELOG entry that says nothing about API impact |
| Modal render check | A lazily-loaded component that compiles but throws when opened |

Also run `npm run check:modals` after moving any component between files.

---

## The three questions a test cannot answer

### 1. Did this change anything a client should know, without adding an endpoint?

This is the one that gets missed, because every automated check passes.

**v2.17.0 is the worked example.** It added an offline filter — no route, no capability, no shape change, manifest unchanged. But it depends on a behaviour a native client would have to rediscover: `GET /api/ips` returns `Free` and `Reserved` placeholder rows as well as devices, and they never answer a ping. A naive offline filter returns every unused address on the subnet.

That belongs in [iOS Client Handover](iOS-Client-Handover), not the endpoint reference.

Ask it of any change to:

- **Filtering, sorting or grouping** — the rule you applied is a rule a client needs
- **What a field means**, even when its shape is unchanged
- **Which rows are real devices** versus placeholders or derived entries
- **Empty, loading and partial states** — "no data" and "nothing has changed" look identical over the wire
- **Anything the interface infers** rather than reads directly

### 2. Is this genuinely additive?

`apiVersion` takes a minor bump for additive changes and a major bump for anything a client must be updated to handle.

Adding a field is additive. Changing what an existing field *means* is not, even though nothing about the shape changed and every test passes.

### 3. Is the new thing off by default?

If so, say so in both the reference and the handover. A client tested against a default install never sees an opt-in feature, so its author has no way to discover it exists — and `capability: true` only means the endpoints are present, not that the user switched it on.

---

## When the surface manifest fails

```
node scripts/api-manifest.cjs        # show what changed
node scripts/api-manifest.cjs --write  # accept it
```

The failure is not asking you to regenerate a file. It is the prompt to decide, before accepting, whether:

1. [API](API) documents the new endpoint
2. [iOS Client Handover](iOS-Client-Handover) covers anything a client must know
3. `apiVersion` needs bumping
4. The CHANGELOG entry states the impact

---

## Release steps

1. `npm test` — unit suite, including every check above
2. `npm run check:modals` — every lazily-loaded modal renders
3. `npm run build` — the front end compiles
4. `node scripts/smoke-test.cjs` against a running install
5. Version bumped in `package.json` **and** `src/shared/common.js`
6. Entries written in `CHANGELOG.md`, `README.md`, `ROADMAP.md` and [What's New](Whats-New)
7. Wiki links resolve

---

## Two habits worth keeping

**Validate a new test by breaking the thing it guards.** A test that passes against correct code proves nothing until it has been seen to fail against incorrect code. Several tests written for this project passed for the wrong reason until they were checked this way — one of them because a sort order happened to produce the right answer.

**A find-and-replace that matches nothing does nothing, silently.** Two releases shipped with no notes because of exactly that. Assert the anchor exists before replacing it.
