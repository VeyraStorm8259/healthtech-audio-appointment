export type AppointmentInput = {
  patientId: string;
  appointmentId: string;
  transcript: string;
  confirmedByClinician: boolean;
};

export type AppointmentAction = {
  state: "ready_for_review" | "notify_patient";
  message: string;
};

export function decideAppointmentAction(input: AppointmentInput): AppointmentAction {
  const asksToReschedule = /reschedul|move the appointment|change the appointment/i.test(input.transcript);
  if (!input.confirmedByClinician || !asksToReschedule) {
    return { state: "ready_for_review", message: "Keep the appointment unchanged until a clinician confirms the next step." };
  }
  return { state: "notify_patient", message: `Appointment ${input.appointmentId} is ready for patient notification.` };
}
