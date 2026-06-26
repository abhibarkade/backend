import * as dotenv from 'dotenv';
import * as path from 'path';
import { execSync } from 'child_process';

const BACKEND_DIR = path.resolve(__dirname, '../..');

export default async function globalSetup() {
  // Load test env first so DATABASE_URL is set for Prisma config
  dotenv.config({ path: path.join(BACKEND_DIR, '.env.test') });

  console.log('\n🗄️  Running Prisma migrations on test database...');
  try {
    execSync('node_modules/.bin/prisma migrate deploy', {
      cwd: BACKEND_DIR,
      env: { ...process.env },
      stdio: 'inherit',
    });
    console.log('✅ Migrations applied.\n');
  } catch (err) {
    console.error('❌ Migration failed. Is PostgreSQL running?');
    throw err;
  }
}
