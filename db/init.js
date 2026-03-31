const { Pool } = require('pg');

const isRender = !!process.env.DATABASE_URL;

const pool = new Pool(
  isRender
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        connectionString:
          process.env.DATABASE_URL ||
          'postgresql://postgres:postgres@localhost:5432/controle_entregas'
      }
);

module.exports = pool;// update Tue Mar 31 13:23:36 -03 2026
