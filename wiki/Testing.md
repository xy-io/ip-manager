# Testing

From **v2.0.2** the repo includes `scripts/smoke-test.cjs` — a read-only script that verifies a running install end-to-end in a few seconds.

It is **safe to run against a live server**. It makes no writes, changes no settings, and mutates no data.

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

It is a fast way to catch broken plumbing, not a substitute for trying the app.
