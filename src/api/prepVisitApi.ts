import { getPrescriptionsByPharmacyVisitId, type VisitPrescription } from './prescriptionsApi';
import { getPatientById } from './patientsApi';
import { getProductsByPrescriptionIds } from './productsApi';
import type { Patient, ProductSummary } from '../domain/types';

export interface PrepVisitDetails {
  patient: Patient;
  prescriptions: VisitPrescription[];
  products: ProductSummary[];
}

/**
 * Loads everything the popup shows for one Pharmacy Visit ID. Throws when the
 * patient can't be resolved, so the caller can show an error instead of opening
 * an empty popup.
 */
export async function loadPrepVisitDetails(pharmacyVisitId: string): Promise<PrepVisitDetails> {
  const prescriptions = await getPrescriptionsByPharmacyVisitId(pharmacyVisitId);
  const patientId = prescriptions.find((p) => p.patientId)?.patientId;
  if (!patientId) {
    throw new Error(`No patient found for pharmacy visit ${pharmacyVisitId}`);
  }

  const [patient, products] = await Promise.all([
    getPatientById(patientId),
    getProductsByPrescriptionIds(prescriptions.map((p) => p.id))
  ]);
  return { patient, prescriptions, products };
}
