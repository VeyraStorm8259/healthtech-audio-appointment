import assert from "node:assert/strict";
import { decideAppointmentAction } from "./appointment_decision.ts";

const result = decideAppointmentAction({
  patientId: "p-17",
  appointmentId: "a-204",
  transcript: "The patient asks to reschedule next Tuesday.",
  confirmedByClinician: false
});

assert.deepEqual(result, {
  state: "ready_for_review",
  message: "Keep the appointment unchanged until a clinician confirms the next step."
});
console.log("appointment decision test passed");
