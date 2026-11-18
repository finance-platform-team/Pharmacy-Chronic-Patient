import { createRecord, deleteRecord, listRecords, updateRecord } from './dataverseClient';
import type { Cr18c_products } from '../domain/dataverseModels/Cr18c_productsModel';
import type { ProductSummary } from '../domain/types';

export async function getProductsByPrescriptionIds(prescriptionIds: string[]): Promise<ProductSummary[]> {
  if (prescriptionIds.length === 0) return [];

  const filterParts = prescriptionIds.map((id) => `_cr18c_prescription_value eq ${id}`);
  const filter = `(${filterParts.join(' or ')}) and statecode eq 0`;

  const rows = await listRecords<Cr18c_products>('cr18c_products', {
    select: [
      'cr18c_productid',
      'cr18c_productname',
      'chp_itemid',
      'cr18c_quantity',
      'cr18c_salesprice',
      'cr18c_costprice',
      '_cr18c_prescription_value'
    ],
    filter,
    top: 200
  }, 'Failed to load products');

  return rows.map((r) => ({
    id: r.cr18c_productid,
    name: r.cr18c_productname ?? null,
    itemId: r.chp_itemid ?? null,
    quantity: r.cr18c_quantity ?? null,
    salesPrice: r.cr18c_salesprice ?? null,
    costPrice: r.cr18c_costprice ?? null,
    prescriptionId: r._cr18c_prescription_value ?? ''
  }));
}

/** The medication fields a pharmacist can add or edit from the Prep Queue visit popup. */
export interface ProductInput {
  name: string;
  itemId: string | null;
  quantity: number | null;
  salesPrice: number | null;
}

function toProductFields(input: ProductInput): Record<string, unknown> {
  return {
    cr18c_productname: input.name,
    chp_itemid: input.itemId,
    cr18c_quantity: input.quantity,
    cr18c_salesprice: input.salesPrice
  };
}

export async function createProduct(prescriptionId: string, input: ProductInput): Promise<void> {
  await createRecord('cr18c_products', {
    ...toProductFields(input),
    'cr18c_prescription@odata.bind': `/cr18c_prescriptions(${prescriptionId})`
  }, 'Failed to add medication');
}

export async function updateProduct(productId: string, input: ProductInput): Promise<void> {
  await updateRecord('cr18c_products', productId, toProductFields(input), 'Failed to update medication');
}

export async function deleteProduct(productId: string): Promise<void> {
  await deleteRecord('cr18c_products', productId, 'Failed to delete medication');
}
