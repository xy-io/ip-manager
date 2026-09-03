# Testing

Two complementary suites: **unit tests** catch broken logic, **smoke tests** catch broken plumbing.

---

## Unit tests

From **v2.7.0**, `npm test` runs 53 unit tests over the parts of the server that have historically broken. Node's built-in test runner is used, so there is no framework and no extra dependency.

```bash
cd /opt/ip-manager
npm test
```

They need no running server and no database — an overridable `DB_PATH` points them at a throwaway file.

| Module | What is checked |
|---|---|
| `lib/net.js` | Subnet validation (the shell-injection guard), interface names, IP sorting across all four octets, the ping status vocabulary, derived `label` and `serviceUrl` |
| `lib/redact.js` | That support bundles cannot leak passwords, hashes, API keys or tokens, and that ordinary log lines are untouched |
| `lib/credentials.js` | Every path through credential loading and the bcrypt migration — the module that has caused two lockout incidents |
| `lib/sessions.js` | Session lifetime, and that the login throttle engages, isolates by address, and resets on success |
| `lib/apikeys.js` | Scope enforcement: read keys cannot write, query-string keys cannot write, account routes stay session-only |

Every test corresponds to something that actually went wrong at some point. The suite was validated by reintroducing two historical bugs and confirming it catches them.

---

## Smoke tests

`scripts/smoke-test.cjs` verifies a **running install** end-to-end in a few seconds.

It is safe to run against a live server. Almost every check is read-only; the API-key group creates two temporary keys and one temporary entry at `203.0.113.253` (a reserved TEST-NET-3 address that can never be a real device) and removes all three afterwards. Pass `--read-only` to skip that group and touch nothing at all.

---

## Running it

```bash
cd /opt/ip-manager
SMOKE_USER=yourname SMOKE_PASS='yourpassword' node scripts/smoke-test.cjs
```

Wrap the password in single quotes — bash will otherwise try to interpret characters like `!`.

No `npm install` is needed; the script uses only built-in Node modules.

### Options

| Variable / flag | Purpose |
|---|---|
| `SMOKE_HA_KEY` | Home Assistant API key. Optional — if omitted, the script reads the key from the server using your session. |
| `--url <base>` | Target a different host. Default `http://127.0.0.1:3001`, which bypasses Nginx and tests the API directly. |
| `--build` | Also run `npm run build` and fail if the frontend build breaks. |
| `--read-only` | Skip the write tests. Nothing is created or deleted. |
| `--verbose` | Print response bodies for failing checks. |

Exit code is `0` when everything passes and `1` on any failure, so it can gate a deployment:

```bash
node scripts/smoke-test.cjs --build && ip-manager-update
```

---

## What it checks

**1. Reachability and authentication** — the server responds, unauthenticated requests are rejected, wrong passwords and unknown usernames are refused, correct credentials succeed and issue a session cookie, and usernames are matched case-insensitively.

**2. Protected endpoints** — every API route returns the expected status code and response shape, including routes that require query parameters.

**3. Status caches** — the ping and service-health caches return well-formed results, and ping values are within the expected set.

**4. Home Assistant API** — missing and incorrect API keys are rejected, all three endpoints return the documented shape, device counts add up, and the reported statuses are real rather than all-unknown.

**4b. API keys and entry endpoints** — keys can be created with a label and scope; a read-only key is refused on writes; a key cannot be used in a query string for writes, cannot manage other keys, and cannot download a support bundle; entries can be created, fetched, patched and deleted individually; conflicting updates are rejected. Temporary keys and entries are cleaned up.

**5. Security regressions** — every route that should require a session actually does, and the support bundle contains no credentials.

**6. Build** — optionally, that the frontend still compiles.

---

## Reading the output

```
4. Home Assistant API
  PASS  GET /api/ha/summary returns the expected shape
  FAIL  HA reports device status rather than all-unknown
        ping cache holds 87 live result(s) but HA reports every device
        as unknown (online=0, offline=0, unknown=87)

Summary
  40 passed  2 failed  1 skipped  (9.4s)
```

Failures repeat at the end with their detail, so a truncated terminal still shows everything that went wrong.

A **SKIP** is not a failure — it means a check couldn't run, usually because no Home Assistant key has been generated or `--build` wasn't passed.

---

## Using it around an update

The most useful habit is to run it **before and after** updating:

```bash
node scripts/smoke-test.cjs > /tmp/before.txt
ip-manager-update
node scripts/smoke-test.cjs > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

Anything that passed before and fails afterwards is a regression introduced by the update, and worth [reporting](https://github.com/xy-io/ip-manager/issues).

---

## Limitations

Worth being clear about what a clean run does **not** prove:

- It exercises the API, not the user interface. A passing run says nothing about whether the front end renders correctly.
- The support-bundle credential check reflects the bundle *at that moment*. The bundle embeds recent log lines, so on a freshly installed server it may contain the generated startup password even when the check passes on an older one.
- Checks that depend on data — device counts, domain expiry — pass trivially when there is no data to look at.
- If the run is interrupted part-way through the API-key group, a key labelled `smoke-test-read` or `smoke-test-write` may be left behind. Delete it in **Settings → API Keys**.

It is a fast way to catch broken plumbing, not a substitute for trying the app.
