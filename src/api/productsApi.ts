import { listRecords } from './dataverseClient';
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