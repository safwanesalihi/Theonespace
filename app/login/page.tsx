import { redirect } from 'next/navigation';
import Login from '@/app/login';
import { getAppUser } from '@/lib/auth';
import { signupEnabled } from '@/lib/signup';

export const dynamic = 'force-dynamic';

// Someone who already holds a valid session belongs in the studio, not on the sign-in form — except
// when they open a « new password » link (?reset=…): that one always shows its form.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string | string[]; mode?: string | string[] }> }) {
  const { reset, mode } = await searchParams;
  if (typeof reset === 'string' && reset) return <Login initialStep="reset" resetToken={reset} />;
  const user = await getAppUser().catch(() => null);
  if (user && !user.mustChangePassword) redirect('/#home');
  // « Essai gratuit » on the landing page (app/landing.tsx) opens the company sign-up form, when it is open.
  const step = user?.mustChangePassword ? 'change-password' : mode === 'signup' && signupEnabled() ? 'sign-up' : 'sign-in';
  return <Login initialStep={step} email={user?.email} />;
}
