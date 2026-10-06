# Partner integration (BaseMaps first)

Meridian is the backend. A partner keeps its own login and its own customers. A partner calls
Meridian server to server with a key. The key decides which partner a request belongs to. Nothing
the caller sends in the body or the query string can change that.

Keys are issued by Meridian. There is no self-serve key management.

## Base URL and the Authorization header

Call the `www` host. The apex domain redirects to `www` with a 308, and that redirect drops the
`Authorization` header. The request then fails with a 401 that looks like a bad key.

```
Authorization: Bearer mrd_<your key>
```

Keys start with `mrd_`. Send them only over HTTPS. Never put a key in a URL, a log line or a browser.

## Create an objective

`POST /api/objectives/create` with a JSON body:

| Field | Required | Notes |
|---|---|---|
| `domain` | yes | e.g. `elk` |
| `taxonomy_key` | yes | e.g. `elk.bull.archery`, `trout.rainbow.fly_fishing` |
| `geo` | yes | `state`, `unit` (the Utah hunt number, e.g. `EA2004`), `lat`, `lon` |
| `priority_stack` | yes | `[]` is fine |
| `timing` | yes | `trip_start`, `trip_end` as `YYYY-MM-DD` |
| `partner_user_ref` | recommended | Your opaque id for your customer, up to 128 characters. Never an email address or a name. |

Ignored when a key is sent: `org_source`, `user_id`. The partner and its service owner come from the key.

Response, `201`:

```json
{ "objective_id": "<objective_profiles id>", "arc_objective_id": "<objectives id>", "assigned_agents": [], "agent_build_status": "ready" }
```

Keep `objective_id`. Use it for the brief.

## Get the brief

`GET /api/mip/brief?objective_id=<objective_id>&partner_key=basemaps`

- `partner_key` is optional. If sent, it must be `basemaps`, or the call returns 403.
- The response is the Meridian brief payload: `summary`, `confidence_tier`, `confidence_pct`,
  `signal_chips`, `time_windows`, `map_pins`, `sources`, `objective_state`, and `attribution`.
- `map_pins` carry the coordinates of your own objective, so that you can draw it. Meridian does not
  log them.
- Response header: `X-MIP-Partner: basemaps`.

## List a customer's objectives

`GET /api/partner/objectives?partner_user_ref=<your customer id>`

Returns only the objectives that your partner created for that `partner_user_ref`. Each entry has
`objective_profile_id`, `objective_id`, `taxonomy_key`, `status`, `hunt_code` and `created_at`. It has
no coordinates and no agent detail.

## What is and is not returned

Returned, for your own objectives only: the brief payload above, and the list entries above.

Not returned, ever:
- objectives from any other partner, or from Meridian's own users
- Meridian user ids, emails, names, or session data
- other customers' `partner_user_ref` values

A request for an objective that is not yours returns `404`. A `404` is the same whether the id does
not exist or belongs to someone else, so ids cannot be probed.

## Errors

| Status | Meaning |
|---|---|
| 400 | Missing or invalid field. The message says which one. |
| 401 | No key, a malformed header, an unknown key, a revoked key, or a suspended partner. |
| 403 | `partner_key` does not match your key. |
| 404 | Objective not found, or not yours. |
| 429 | Rate limit reached. Wait for the number of seconds in `Retry-After`. |
| 503 | Your partner is not set up yet. Contact Meridian. |

## Rate limits

Each key has a limit per minute, 60 by default. Meridian sets the limit per partner.

Limitation: the counter is held in memory, per server instance. The effective limit is therefore
higher than the stated limit when several instances are warm. Treat it as a guard against runaway
clients, not as a quota. Do not build billing on it.

## Keys, rotation and revocation

- Meridian issues a key by running `scripts/issue-partner-key.mjs`. The raw key is shown once. Meridian
  stores only its SHA-256 hash.
- To rotate, Meridian issues a new key. Your old key keeps working until Meridian revokes it.
- A revoked key returns 401 immediately. A suspended partner returns 401 for all of its keys.
- Store your key in a secrets manager. Do not commit it.

## Privacy rules for your side

- `partner_user_ref` is an opaque id, not personal data. Do not send an email address, a phone
  number, a name or a home address.
- Do not send coordinates in a `partner_user_ref`, a log line or an error report.
