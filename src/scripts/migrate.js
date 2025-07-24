const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ,
});

const migrations = [
  `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    invoice_number VARCHAR(50) UNIQUE NOT NULL,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(255),
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    issue_date DATE NOT NULL,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    transaction_id VARCHAR(50) UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT NOT NULL,
    transaction_date DATE NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    category VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    conversation_id VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    sender VARCHAR(10) NOT NULL CHECK (sender IN ('user', 'bot')),
    intent VARCHAR(50),
    extracted_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_invoices_user_id ON invoices(user_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
  CREATE INDEX IF NOT EXISTS idx_conversations_conversation_id ON conversations(conversation_id);
  `
];

async function runMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('Starting database migrations...');
    
    for (let i = 0; i < migrations.length; i++) {
      console.log(`Running migration ${i + 1}/${migrations.length}...`);
      await client.query(migrations[i]);
    }
    
    console.log('Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch(console.error);
}

module.exports = { runMigrations };
