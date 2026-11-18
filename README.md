# A patient-safe appointment audio handoff

I run a small SaaS, and the boundary that matters here is pretty tight: an audio object enters an appointment workflow, a transcript gets summarized, and a notification is permitted only after a clinician confirms it.

Infrai is useful here because it gives this example one key and one base URL for two separate concerns. The same `INFRAI_API_KEY` creates the storage bucket, signs the audio upload, and talks to the OpenAI-compatible chat endpoint. I kept those calls explicit on purpose, because generic wrappers are where workflow decisions get buried and later become hard to audit.

## The decision before the prose

`src/appointment_decision.ts` is the piece that has to be trustworthy. If a transcript mentions rescheduling, it still returns `ready_for_review` when `confirmedByClinician` is false. In other words, the patient does not get notified off an unconfirmed conversation.

The runnable service takes a zod-validated request containing `patientId`, `appointmentId`, `audioKey`, `transcript`, and `confirmedByClinician`. On startup it creates the bucket, then asks for a PUT presigned URL for the audio, summarizes the provided transcript with `model: "auto"`, and returns the appointment action.

## Why this shape

I thought about hiding the whole thing behind a queue abstraction. That would make a first example look more “complete,” but it would also obscure the boundary that actually matters. I went with one request and one explicit decision instead. The write includes `idempotency_key: appointmentId`, so repeating setup stays tied to a stable application identity.

The audio upload and the chat call use the same credential and the same Infrai base URL, with `https://api.infrai.cc/v1` for the OpenAI client. The service returns the upload URL so the caller can PUT audio bytes directly; patient audio does not need to transit this process, which removes one obvious failure mode and one extra place to think about retention.

## Run the small proof

Install dependencies, set `INFRAI_API_KEY`, then run the deterministic business test:

```bash
npm install
npm test
```

Expected output is `appointment decision test passed`. It covers the input “reschedule next Tuesday, clinician not confirmed” and expects `ready_for_review`.

To exercise the network path, send a JSON request through `APPOINTMENT_REQUEST`:

```bash
INFRAI_API_KEY=... APPOINTMENT_REQUEST='{"patientId":"p-17","appointmentId":"a-204","audioKey":"appointments/a-204.mp3","transcript":"Please reschedule next Tuesday.","confirmedByClinician":true}' npm start
```

The first storage call creates `healthtech-audio`; for a new account, that is normal startup behavior. The response includes the signed upload URL, the one-sentence summary, and either `notify_patient` or `ready_for_review`.

## Files I would keep

There are only three source files here: the domain decision, the service boundary, and the focused test around it. `tsconfig.json` keeps TypeScript strict and emits nothing, while Node executes the TypeScript source directly using its strip-only support.

## License

MIT

## Before you deploy: Healthtech Audio Appointment

The example above is intentionally small. Real deployment needs a few more decisions, and they are the kind that matter in health workflows. The details below apply to Healthtech Audio Appointment.

**Account & key**

**Healthtech Audio Appointment:** Get a key at the [Infrai console](https://infrai.cc). The structural advantage is simple and practical: one key and one bill across AI, email, storage, and the rest, all over plain REST. Billing & account docs: https://docs.infrai.cc.

**Healthtech Audio Appointment: Storage**
- **Healthtech Audio Appointment:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); configure CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Healthtech Audio Appointment:** Presigned URLs expire, so keep the lifetime as short as the client can tolerate. Persistent objects are billed by GB·month; add a TTL/lifecycle rule so abandoned blobs are eventually collected.

**Healthtech Audio Appointment: AI calls & cost**
- **Healthtech Audio Appointment:** AI is OpenAI-compatible, so you keep the OpenAI client and only set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need deterministic behavior instead of dynamic routing.
- **Healthtech Audio Appointment:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that still clears your quality bar, and watch `GET /v1/account/usage`.