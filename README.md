# Dikrashop v2 — Shipping Backend

## ZR Webhooks

ZR Express uses [Svix](https://svix.com) to deliver real-time parcel lifecycle events. This feature receives those events, verifies their signatures, and writes the updated status back to the corresponding Notion order page.

### Setup steps

**1. Add env vars to `.env`**

```env
# Public HTTPS URL that ZR will POST events to
ZR_WEBHOOK_URL=https://your-server.com/webhooks/zrexpress

# Bearer token for the registration API call (may be the same value as ZR_API_KEY)
ZR_ACCESS_TOKEN=your_zr_access_token
```

> **Local development:** expose your local server with a tunnel first (e.g. `ngrok http 3000`), then set `ZR_WEBHOOK_URL` to the tunnel URL before running the script.

**2. Register the endpoint with ZR Express**

```bash
npm run webhook:register
```

The script POSTs to the ZR webhook API, then immediately fetches the signing secret and prints it:

```
WEBHOOK_SECRET=whsec_...
```

**3. Add the signing secret to `.env`**

```env
WEBHOOK_SECRET=whsec_...
```

**4. Restart the server**

```bash
npm start
```

The route is live at `POST /webhooks/zrexpress`.

### Notion database properties required

Add these properties to your Notion orders database if they don't exist yet:

| Property name    | Type       | Purpose                                      |
|------------------|------------|----------------------------------------------|
| `حالة التوصيل`  | Select     | ZR delivery state (e.g. "Out for Delivery")  |
| `آخر تحديث`     | Date       | Timestamp of the last ZR event               |
| `آخر وضعية`     | Rich text  | Most recent situation name                   |
| `وصف الوضعية`   | Rich text  | Situation description                        |
| `سجل المكالمات` | Rich text  | Chronological log of call attempt events     |
| `إرجاع`         | Checkbox   | True when the parcel is a return             |

The server logs a `WARN` with the property name whenever an update fails because the property doesn't exist, so you can add any missing ones and the next event will succeed.

### Event types handled

| Event type                        | What it means                                      |
|-----------------------------------|----------------------------------------------------|
| `parcel.state.updated`            | Parcel moved to a new coarse state                 |
| `parcel.state.situation.created`  | Sub-status attached (call attempts, etc.)          |
| `parcel.isReturn.updated`         | Return flag toggled                                |

### Extending state/situation mappings

Open `src/webhooks/zrWebhook.ts` and update:

- **`KNOWN_STATE_NAMES`** — add lowercase state names observed in logs to suppress the `WARN` for them.
- **`CALL_ATTEMPT_KEYWORDS`** — add slug substrings that should trigger a call-log entry (e.g. `"third"` once you observe a third-attempt slug in live events).

Unknown states and slugs are always logged at `WARN` level so you can discover and map them over time.
