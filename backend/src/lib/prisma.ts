import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
  // Always talk to PostgreSQL in UTC. The Prisma pg adapter reads timestamptz values
  // wrongly (shifted by the session's UTC offset) when the database's TimeZone setting
  // is not UTC, e.g. a server configured for Africa/Nairobi.
  options: "-c timezone=UTC",
});

const prisma = new PrismaClient({
  adapter,
});

export default prisma;