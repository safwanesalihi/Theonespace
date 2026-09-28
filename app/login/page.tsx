import { redirect } from 'next/navigation';
import Login from '@/app/login';
import { getAppUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Someone who already holds a valid session belongs in the studio, not on the sign-in form — except
// when they open a « new password » link (?reset=…): that one always shows its form.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string | string[] }> }) {
  const { reset } = await searchParams;
  if (typeof reset === 'string' && reset) return <Login initialStep="reset" resetToken={reset} />;
  const user = await getAppUser().catch(() => null);
  if (user && !user.mustChangePassword) redirect('/#home');
  return <Login initialStep={user?.mustChangePassword ? 'change-password' : 'sign-in'} email={user?.email} />;
}
