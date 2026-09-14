const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não configurada.");
}

const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000);
const statementTimeout = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis,
  idleTimeoutMillis: 30000,
  max: Number(process.env.DB_POOL_MAX || 10),
  statement_timeout: statementTimeout,
  query_timeout: statementTimeout,
});

pool.on("error", (error) => {
  console.error("Erro inesperado no pool PostgreSQL:", {
    message: error.message,
    code: error.code,
  });
});

module.exports = pool;
