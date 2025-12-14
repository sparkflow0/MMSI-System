# MMSI Assignment API

`POST /api/assign-mmsi`  
Assigns the next available MMSI within the configured range (408000001–408999998), skipping any exclusion ranges. Persists the ship record into `active_ships` and updates `mmsi_pool`.

## Authentication
- Server-side Supabase credentials (`SUPABASE_URL` + service key).
- API token: include either `Authorization: Bearer <token>` or header `x-api-token: <token>`. The token is configured via one of:
  - `ASSIGN_MMSI_TOKEN`
  - `API_TOKEN`
  - `API_SECRET`
  If none of these env vars are set, the token check is skipped (backward compatibility), but production deployments should set one.

## Request
`Content-Type: application/json`

### Required Fields
- `ship_name` (string)
- `call_sign` (string)
- `owner_name` (string)
- `reg_no` (string)
- `registration_date` (YYYY-MM-DD)
- `expiry_date` (YYYY-MM-DD)

### Optional Fields
- `ship_type` (string, defaults to `"Gen"`)

### Example
```bash
curl -X POST https://your-host/api/assign-mmsi \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "ship_name": "Falcon",
    "call_sign": "A9XXX",
    "owner_name": "John Doe",
    "reg_no": "REG-123",
    "registration_date": "2024-01-02",
    "expiry_date": "2026-01-01",
    "ship_type": "Gen"
  }'
```

## Success Response (200)
```json
{
  "mmsi": "408000123",
  "ship_name": "Falcon",
  "call_sign": "A9XXX",
  "registration_date": "2024-01-02",
  "expiry_date": "2026-01-01",
  "owner_name": "John Doe",
  "reg_no": "REG-123",
  "ship_type": "Gen",
  "ship": {
    "ship_name": "Falcon",
    "call_sign": "A9XXX",
    "registration_date": "2024-01-02",
    "expiry_date": "2026-01-01",
    "owner_name": "John Doe",
    "reg_no": "REG-123",
    "ship_type": "Gen"
  }
}
```

## Error Responses
- `400 Bad Request` – Missing one or more required fields (`ship_name`, `call_sign`, `owner_name`, `reg_no`, `registration_date`, `expiry_date`).
- `409 Conflict` – No available MMSI in range or repeated collision during concurrent assignments.
- `500 Internal Server Error` – Unexpected server or database error.

## Behavior Notes
- The handler loads all current `active_ships` and `mmsi_exclusions`, then finds the next available MMSI not in use and not excluded.
- If an insert collision occurs (e.g., concurrent assignment), it retries with the next free MMSI until success or exhaustion.
- On success, it upserts to `mmsi_pool` with `status: "Assigned"` and `assigned_name: ship_name`.

## Required Server Env Vars
- `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
- `SUPABASE_SERVICE_ROLE` or `SUPABASE_SERVICE_KEY` (falls back to `VITE_SUPABASE_KEY` if provided)
- API token (recommended): `ASSIGN_MMSI_TOKEN` (or `API_TOKEN` / `API_SECRET`)
