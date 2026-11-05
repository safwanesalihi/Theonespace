import { redirect } from 'next/navigation';
import Login from '@/features/auth/login';
import { getAppUser } from '@/lib/auth';
import { signupEnabled } from '@/lib/signup';
import '@/app/styles.css'; // the app's stylesheet (app/layout.tsx carries only app/base.css)

export const dynamic = 'force-dynamic';

// Someone who already holds a valid session belongs in the studio, not on the sign-in form — except
// when they open a « new password » link (?reset=…): that one always shows its form.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string | string[]; mode?: string | string[]; demande?: string | string[] }> }) {
  const { reset, mode, demande } = await searchParams;
  if (typeof reset === 'string' && reset) return <Login initialStep="reset" resetToken={reset} />;
  const user = await getAppUser().catch(() => null);
  if (user && !user.mustChangePassword) redirect('/#home');
  // The landing's calls to action: « Demander un accès » (?demande=1, lib/access-requests.ts), or the company
  // sign-up form when public sign-up is on (?mode=signup, which falls back to the request when it is off).
  const wantsSpace = typeof demande === 'string' || mode === 'signup';
  const step = user?.mustChangePassword ? 'change-password' : !wantsSpace ? 'sign-in' : mode === 'signup' && signupEnabled() ? 'sign-up' : 'request';
  return <Login initialStep={step} email={user?.email} />;
}
