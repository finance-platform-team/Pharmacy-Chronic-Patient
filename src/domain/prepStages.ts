// Preparation workflow on chp_omnitasks.chp_prepstatus (global choice "Prep Status"):
// Called → Medication Recorded → Ready for Pickup / Ready for Delivery → Fulfilled.
// The third step's name follows the cycle's Fulfilment Path.

export const PREP_STATUS_CALLED = '766990000';
export const PREP_STATUS_MEDICATION_RECORDED = '766990001';
export const PREP_STATUS_READY_PICKUP = '766990002';
export const PREP_STATUS_READY_DELIVERY = '766990003';
export const PREP_STATUS_FULFILLED = '766990004';

export type PrepStage = 'none' | 'called' | 'recorded' | 'ready' | 'fulfilled';

const STAGE_ORDER: Exclude<PrepStage, 'none'>[] = ['called', 'recorded', 'ready', 'fulfilled'];

function readyLabel(fulfilmentPath: string | null): string {
  return fulfilmentPath === 'Pickup' ? 'Ready for Pickup' : 'Ready for Delivery';
}

/** The four status-bar steps, with the Ready step named after the Fulfilment Path. */
export function prepSteps(fulfilmentPath: string | null): { stage: Exclude<PrepStage, 'none'>; label: string }[] {
  return [
    { stage: 'called', label: 'Called' },
    { stage: 'recorded', label: 'Medication Recorded' },
    { stage: 'ready', label: readyLabel(fulfilmentPath) },
    { stage: 'fulfilled', label: 'Fulfilled' }
  ];
}

export function stageOf(prepStatus: string | null): PrepStage {
  switch (prepStatus) {
    case PREP_STATUS_CALLED: return 'called';
    case PREP_STATUS_MEDICATION_RECORDED: return 'recorded';
    case PREP_STATUS_READY_PICKUP:
    case PREP_STATUS_READY_DELIVERY: return 'ready';
    case PREP_STATUS_FULFILLED: return 'fulfilled';
    default: return 'none';
  }
}

/** 0 = not started, 4 = fulfilled — how many status-bar steps are reached. */
export function stageIndex(stage: PrepStage): number {
  return stage === 'none' ? 0 : STAGE_ORDER.indexOf(stage) + 1;
}

export function readyStatusFor(fulfilmentPath: string | null): string {
  return fulfilmentPath === 'Pickup' ? PREP_STATUS_READY_PICKUP : PREP_STATUS_READY_DELIVERY;
}

export function stageLabel(prepStatus: string | null): string {
  switch (prepStatus) {
    case PREP_STATUS_CALLED: return 'Called';
    case PREP_STATUS_MEDICATION_RECORDED: return 'Medication Recorded';
    case PREP_STATUS_READY_PICKUP: return 'Ready for Pickup';
    case PREP_STATUS_READY_DELIVERY: return 'Ready for Delivery';
    case PREP_STATUS_FULFILLED: return 'Fulfilled';
    default: return 'Not started';
  }
}

/** The single forward move available from the current stage, if any. */
export function nextStage(prepStatus: string | null, fulfilmentPath: string | null): { label: string; status: string } | null {
  switch (stageOf(prepStatus)) {
    case 'none': return { label: 'Mark Called', status: PREP_STATUS_CALLED };
    case 'called': return { label: 'Medication Recorded', status: PREP_STATUS_MEDICATION_RECORDED };
    case 'recorded': return { label: readyLabel(fulfilmentPath), status: readyStatusFor(fulfilmentPath) };
    case 'ready': return { label: 'Mark Fulfilled', status: PREP_STATUS_FULFILLED };
    default: return null;
  }
}
