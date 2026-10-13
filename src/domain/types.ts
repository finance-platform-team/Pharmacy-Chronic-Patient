export interface Patient {
  id: string;
  name: string;
  phoneNumber: string;

  businessUnitId: string | null;
  businessUnitName: string | null;

  insuranceCompany: string | null;
  pharmacyName: string | null;

  userId: string | null;
  userName: string | null;

  noOfPrescriptions: number | null;
  noOfPrescriptionsDate: string | null;

  totalDispensingValue: number | null;
  totalDispensingValueDate: string | null;

  orderDay: string | null;

  chronicPatientType: string | null;
  chronicStatus: string | null;

  descriptionFileName: string | null;
  insuranceCardFileName: string | null;
  approvalFileName: string | null;

  createdOn: string | null;
}
export interface PrescriptionSummary {
  id: string;
  name: string;
  pharmacyName: string | null;
  dispensedValue: number | null;
  dispensed: boolean;
  monthlyDispensingDate: string | null;
  eligibility: string | null;
  chronicStatus: string | null;
}

export interface ProductSummary {
  id: string;
  name: string | null;
  itemId: string | null;
  quantity: number | null;
  salesPrice: number | null;
  costPrice: number | null;
  prescriptionId: string;
}
export interface PrescriptionRow {
  id: string;
  name: string;
  patientId: string | null;
  patientName: string | null;
  patientMobile: string | null;
  pharmacyName: string | null;
  eligibility: string | null;
  availability: string | null;
  chronicStatus: string | null;
  dispensedValue: number | null;
  monthlyDispensingDate: string | null;
  orderDay: number | null;
  businessUnit: string | null;
  dispensed: boolean;
  createdOn: string | null;
}