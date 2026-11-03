// The payment details on the server (lib/payment-details.ts): one row in `site_content`, under its own key, so
// GET /api/site (which reads the « landing » key only) can never serve it.
import { database, type Db } from '@/lib/database';
import { readPaymentDetails, type PaymentDetails } from '@/lib/payment-details';
import { ensureSiteTable } from '@/lib/site-content-server';

export async function paymentDetails(db: Db = database()): Promise<PaymentDetails> {
  await ensureSiteTable(db);
  const row = (await db.query<{ data: unknown }>("SELECT data FROM site_content WHERE key = 'payment'"))[0];
  return readPaymentDetails(row?.data ?? null);
}

/** Saves already validated details (paymentDetailsSchema). */
export async function savePaymentDetails(details: PaymentDetails, by: string, db: Db = database()): Promise<PaymentDetails> {
  await ensureSiteTable(db);
  await db.query(
    `INSERT INTO site_content (key, data, updated_at, updated_by) VALUES ('payment', $1::jsonb, now(), $2)
     ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(details), by],
  );
  return paymentDetails(db);
}
