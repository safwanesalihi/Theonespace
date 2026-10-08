// The workspace's records: GET loads the page's data, POST applies one change. The request pipeline and
// the actions live in features/records/server (see docs/architecture.md).
import { getRecords, postRecords } from '@/features/records/server/pipeline';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  return getRecords(req);
}

export async function POST(req: Request) {
  return postRecords(req);
}
