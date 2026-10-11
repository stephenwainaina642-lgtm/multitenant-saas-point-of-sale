import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "pos_system",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
});

export async function testDatabaseConnection() {
  const client = await pool.connect();

  try {
    const result = await client.query("SELECT NOW()");
    console.log("PostgreSQL connected:", result.rows[0].now);
  } finally {
    client.release();
  }
}