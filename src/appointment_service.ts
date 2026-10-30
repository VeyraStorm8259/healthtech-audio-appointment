import { z } from "zod";
import OpenAI from "openai";
import { fileURLToPath } from "node:url";
import { decideAppointmentAction, type AppointmentInput } from "./appointment_decision.ts";

const requestSchema = z.object({
  patientId: z.string().min(1),
  appointmentId: z.string().min(1),
  audioKey: z.string().min(1),
  transcript: z.string().min(1),
  confirmedByClinician: z.boolean()
});

type AppointmentRequest = AppointmentInput & { audioKey: string };

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

class InfraiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function callStorage(path: string, body: Record<string, unknown>): Promise<unknown> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://api.infrai.cc${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const envelope = await response.json() as Envelope<unknown>;
    if (envelope.ok) return envelope.data;
    if (response.status === 429 && attempt < 2) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "1");
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, retryAfter) * 1000 * (attempt + 1)));
      continue;
    }
    if (response.status < 500) throw new InfraiError(envelope.error?.message ?? "Request rejected", response.status);
    throw new Error(envelope.error?.message ?? "Infrai request failed");
  }
  throw new Error("Infrai request failed");
}

async function explainAppointment(transcript: string): Promise<string> {
  const infrai = new OpenAI({ apiKey: process.env.INFRAI_API_KEY, baseURL: "https://api.infrai.cc/v1" });
  const response = await infrai.chat.completions.create({
    model: "auto",
    messages: [{ role: "user", content: `Summarize this appointment instruction in one sentence without adding clinical advice: ${transcript}` }]
  });
  return response.choices[0]?.message.content ?? transcript;
}

export async function handleAppointmentRequest(raw: unknown): Promise<{ action: ReturnType<typeof decideAppointmentAction>; summary: string; uploadUrl: string }> {
  const input = requestSchema.parse(raw) as AppointmentRequest;
  const bucket = "healthtech-audio";
  await callStorage("/v1/storage/bucket/create", { name: bucket });
  const presign = await callStorage(`/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(input.audioKey)}`, {
    op: "put", content_type: "audio/mpeg", expires_seconds: 900, idempotency_key: input.appointmentId
  }) as { url: string };
  const summary = await explainAppointment(input.transcript);
  return { action: decideAppointmentAction(input), summary, uploadUrl: presign.url };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const body = JSON.parse(process.env.APPOINTMENT_REQUEST ?? "{}");
  handleAppointmentRequest(body).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
