import prisma from "../lib/prisma.js";

type SupplierData = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};

export async function getBusinessSuppliers(
  businessId: string
) {
  const suppliers = await prisma.supplier.findMany({
    where: {
      businessId: BigInt(businessId),
      isActive: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return suppliers.map((supplier) => ({
    id: supplier.id.toString(),
    name: supplier.name,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    notes: supplier.notes,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt,
  }));
}

export async function createBusinessSupplier(
  businessId: string,
  data: SupplierData
) {
  const supplier = await prisma.supplier.create({
    data: {
      businessId: BigInt(businessId),
      name: data.name,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      notes: data.notes || null,
      isActive: true,
    },
  });

  return {
    id: supplier.id.toString(),
    name: supplier.name,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    notes: supplier.notes,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt,
  };
}

export async function updateBusinessSupplier(
  businessId: string,
  supplierId: string,
  data: Partial<SupplierData>
) {
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: BigInt(supplierId),
      businessId: BigInt(businessId),
      isActive: true,
    },
  });

  if (!supplier) {
    throw new Error("Supplier not found");
  }

  const updatedSupplier = await prisma.supplier.update({
    where: {
      id: BigInt(supplierId),
    },
    data,
  });

  return {
    id: updatedSupplier.id.toString(),
    name: updatedSupplier.name,
    phone: updatedSupplier.phone,
    email: updatedSupplier.email,
    address: updatedSupplier.address,
    notes: updatedSupplier.notes,
    isActive: updatedSupplier.isActive,
    createdAt: updatedSupplier.createdAt,
  };
}

export async function deleteBusinessSupplier(
  businessId: string,
  supplierId: string
) {
  const supplier = await prisma.supplier.findFirst({
    where: {
      id: BigInt(supplierId),
      businessId: BigInt(businessId),
      isActive: true,
    },
  });

  if (!supplier) {
    throw new Error("Supplier not found");
  }

  const deletedSupplier = await prisma.supplier.update({
    where: {
      id: BigInt(supplierId),
    },
    data: {
      isActive: false,
    },
  });

  return {
    id: deletedSupplier.id.toString(),
    name: deletedSupplier.name,
    isActive: deletedSupplier.isActive,
  };
}
