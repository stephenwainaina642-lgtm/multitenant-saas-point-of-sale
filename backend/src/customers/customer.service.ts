import prisma from "../lib/prisma.js";

type CustomerData = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
};

export async function getBusinessCustomers(
  businessId: string
) {
  const customers = await prisma.customer.findMany({
    where: {
      businessId: BigInt(businessId),
      isActive: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return customers.map((customer) => ({
    id: customer.id.toString(),
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    notes: customer.notes,
    isActive: customer.isActive,
    createdAt: customer.createdAt,
  }));
}

export async function createBusinessCustomer(
  businessId: string,
  data: CustomerData
) {
  const customer = await prisma.customer.create({
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
    id: customer.id.toString(),
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    notes: customer.notes,
    isActive: customer.isActive,
    createdAt: customer.createdAt,
  };
}

export async function updateBusinessCustomer(
  businessId: string,
  customerId: string,
  data: Partial<CustomerData>
) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: BigInt(customerId),
      businessId: BigInt(businessId),
      isActive: true,
    },
  });

  if (!customer) {
    throw new Error("Customer not found");
  }

  const updatedCustomer = await prisma.customer.update({
    where: {
      id: BigInt(customerId),
    },
    data,
  });

  return {
    id: updatedCustomer.id.toString(),
    name: updatedCustomer.name,
    phone: updatedCustomer.phone,
    email: updatedCustomer.email,
    address: updatedCustomer.address,
    notes: updatedCustomer.notes,
    isActive: updatedCustomer.isActive,
    createdAt: updatedCustomer.createdAt,
  };
}

export async function deleteBusinessCustomer(
  businessId: string,
  customerId: string
) {
  const customer = await prisma.customer.findFirst({
    where: {
      id: BigInt(customerId),
      businessId: BigInt(businessId),
      isActive: true,
    },
  });

  if (!customer) {
    throw new Error("Customer not found");
  }

  const deletedCustomer = await prisma.customer.update({
    where: {
      id: BigInt(customerId),
    },
    data: {
      isActive: false,
    },
  });

  return {
    id: deletedCustomer.id.toString(),
    name: deletedCustomer.name,
    isActive: deletedCustomer.isActive,
  };
}
