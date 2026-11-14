import prisma from "../lib/prisma.js";
import { AppError } from "../lib/errors.js";
import {
  decimalToCents,
  lineAmount,
  parseMoney,
  parseQuantity,
} from "../lib/money.js";

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type RawSaleItem = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  tax?: number;
};

export type SaleLine = {
  productId: bigint;
  productName: string;
  quantity: bigint; // thousandths
  unitPrice: bigint; // cents
  costPrice: bigint; // cents
  discount: bigint;
  tax: bigint;
  total: bigint;
};

type LineOptions = {
  /**
   * Editing: products already on the sale. They stay valid even if archived,
   * and their original unit price stays acceptable if the catalogue price has
   * since changed.
   */
  existing?: Map<bigint, Set<bigint>>;
};

/** Validate raw items against the catalogue and price them exactly. */
export async function buildSaleLines(
  tx: Tx,
  businessId: bigint,
  items: RawSaleItem[],
  options: LineOptions = {}
): Promise<SaleLine[]> {
  const lines: SaleLine[] = [];

  for (const item of items) {
    const quantity = parseQuantity(item.quantity, "Quantity");
    const unitPrice = parseMoney(item.unitPrice, "Unit price");
    const discount = parseMoney(item.discount ?? 0, "Discount");
    const tax = parseMoney(item.tax ?? 0, "Tax");

    if (quantity <= 0n) {
      throw new AppError(400, "Quantity must be greater than zero");
    }
    if (unitPrice < 0n) {
      throw new AppError(400, "Unit price cannot be negative");
    }
    if (discount < 0n) {
      throw new AppError(400, "Discount cannot be negative");
    }
    if (tax < 0n) {
      throw new AppError(400, "Tax cannot be negative");
    }

    let productId: bigint;
    try {
      productId = BigInt(item.productId);
    } catch {
      throw new AppError(404, `Product not found: ${item.productId}`);
    }

    const keptFromSale = options.existing?.has(productId) ?? false;

    const product = await tx.product.findFirst({
      where: {
        id: productId,
        businessId,
        ...(!keptFromSale && { isActive: true }),
      },
    });

    if (!product) {
      throw new AppError(404, `Product not found: ${item.productId}`);
    }

    const catalogueOk = unitPrice === decimalToCents(product.sellingPrice);
    const originalOk = options.existing?.get(productId)?.has(unitPrice) ?? false;

    if (!catalogueOk && !originalOk) {
      throw new AppError(
        400,
        `Sale price does not match the saved selling price for: ${product.name}`
      );
    }

    const lineTotal = lineAmount(quantity, unitPrice) - discount + tax;

    if (lineTotal < 0n) {
      throw new AppError(400, "Item total cannot be negative");
    }

    lines.push({
      productId: product.id,
      productName: product.name,
      quantity,
      unitPrice,
      costPrice: decimalToCents(product.costPrice),
      discount,
      tax,
      total: lineTotal,
    });
  }

  return lines;
}

/**
 * subtotal = gross of all lines; discount and tax include both the line-level
 * and the sale-level amounts, so total = subtotal - discount + tax always holds.
 */
export function computeSaleTotals(
  lines: SaleLine[],
  saleDiscountInput: unknown,
  saleTaxInput: unknown
) {
  const saleDiscount = parseMoney(saleDiscountInput ?? 0, "Sale discount");
  const saleTax = parseMoney(saleTaxInput ?? 0, "Sale tax");

  if (saleDiscount < 0n) {
    throw new AppError(400, "Sale discount cannot be negative");
  }
  if (saleTax < 0n) {
    throw new AppError(400, "Sale tax cannot be negative");
  }

  const subtotal = lines.reduce(
    (sum, l) => sum + lineAmount(l.quantity, l.unitPrice),
    0n
  );
  const discount = lines.reduce((sum, l) => sum + l.discount, saleDiscount);
  const tax = lines.reduce((sum, l) => sum + l.tax, saleTax);
  const total = subtotal - discount + tax;

  if (total < 0n) {
    throw new AppError(400, "Sale total cannot be negative");
  }

  return { subtotal, discount, tax, total };
}

/** Sum quantities per product, ordered by id (stable lock order). */
export function aggregateByProduct(
  lines: { productId: bigint; productName?: string; quantity: bigint }[]
) {
  const map = new Map<bigint, { name: string; quantity: bigint }>();

  for (const l of lines) {
    const entry = map.get(l.productId);
    if (entry) entry.quantity += l.quantity;
    else map.set(l.productId, { name: l.productName ?? "", quantity: l.quantity });
  }

  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
