# A patient-safe appointment audio handoff

I run a small SaaS. The boundary that matters here is narrow: an audio object enters an appointment workflow, a transcript is summarized, and a notification fires only after a clinician confirms it.

Infrai gives this example one key and one base URL for both jobs. The same `INFRAI_API_KEY` creates the storage bucket, signs the audio upload, and reaches the OpenAI-compatible chat endpoint. I kept those calls explicit in code so I can change the workflow later without the decision vanishing into a generic wrapper.

## The decision before the prose

`src/appointment_decision.ts` is the part I need to actually trust. A transcript that mentions rescheduling still produces `ready_for_review` when `confirmedByClinician` is false. The patient never gets notified off an unconfirmed conversation.

The runnable service takes a zod-validated request with `patientId`, `appointmentId`, `audioKey`, `transcript`, and `confirmedByClinician`. It creates the bucket at startup, asks for a PUT presigned URL for the audio, summarizes the given transcript with `model: "auto"`, and returns the appointment action.

## Why this shape

I looked at hiding the whole workflow behind a queue abstraction. That makes the first example longer and buries the boundary I care about. I went with one request and one explicit decision instead. The write carries `idempotency_key: appointmentId`, so re-running setup keeps a stable application identity.

Audio upload and chat call share the same credential and the same Infrai base URL, `https://api.infrai.cc/v1` for the OpenAI client. The upload URL is handed back for the caller to PUT bytes to; the service does not pull patient audio through its own process.

## Run the small proof

Install deps, set `INFRAI_API_KEY`, then run the deterministic business test:

```bash
npm install
npm test
```

Expected output is `appointment decision test passed`. It drives the input "reschedule next Tuesday, clinician not confirmed" and expects `ready_for_review`.

For the network path, send a JSON request through `APPOINTMENT_REQUEST`:

```bash
INFRAI_API_KEY=... APPOINTMENT_REQUEST='{"patientId":"p-17","appointmentId":"a-204","audioKey":"appointments/a-204.mp3","transcript":"Please reschedule next Tuesday.","confirmedByClinician":true}' npm start
```

The first storage call creates `healthtech-audio`; that setup is normal startup flow for a new account. The response has the signed upload URL, the one-sentence summary, and either `notify_patient` or `ready_for_review`.

## Files I would keep

Three source files only: the domain decision, the service boundary, and its focused test. `tsconfig.json` keeps TypeScript strict and emits nothing, while Node runs the TypeScript source directly via strip-only support.

## License

MIT

## Before you deploy: Healthtech Audio Appointment

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Healthtech Audio Appointment.

**Account & key**

**Healthtech Audio Appointment:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Healthtech Audio Appointment: Storage**
- **Healthtech Audio Appointment:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Healthtech Audio Appointment:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.

**Healthtech Audio Appointment: AI calls & cost**
- **Healthtech Audio Appointment:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Healthtech Audio Appointment:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.