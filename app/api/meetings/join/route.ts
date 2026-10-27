// « Rejoindre » a meeting (lib/meetings.ts): checks that the person is invited and that the meeting is
// open, then hands back where the call happens — the link the studio pasted (Google Meet, Zoom…), or a
// personal link into the meeting's private Daily room (lib/daily.ts), opened inside the app.
// GET says whether calls are switched on, for the planning form.
import { countUsage, meterRefusal, planRefusal } from '@/lib/subscription';
import { getAppUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/auth-settings';
import { dailyConfigured, joinLink } from '@/lib/daily';
import { database } from '@/lib/database';
import { membershipOf } from '@/lib/membership';
import { json } from '@/lib/editorial-access';
import { lockedMeeting } from '@/lib/meeting-server';
import { canPlanMeetings, invitedTo, meetingEnd, meetingLimits, meetingPhase } from '@/lib/meetings';
import { isWorkspaceRole } from '@/lib/workspace';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await getAppUser(req))) return json({ error: 'Connexion requise.' }, 401);
  return json({ calls: dailyConfigured() });
}

export async function POST(req: Request) {
  const user = await getAppUser(req);
  if (!user) return json({ error: 'Connexion requise.' }, 401);
  if (user.mustChangePassword) return json({ error: 'Choisissez votre mot de passe pour continuer.', code: 'password-change-required' }, 403);
  if (!sameOrigin(req)) return json({ error: 'Origine non autorisée.' }, 403);
  const workspaceId = req.headers.get('X-Workspace-Id');
  if (!workspaceId) return json({ error: 'Espace inconnu.' }, 400);
  const member = await membershipOf(workspaceId, user.userId);
  if (!member || !isWorkspaceRole(member.role)) return json({ error: 'Vous n’avez pas accès à cet espace.' }, 403);
  const role = member.role;
  const refusal = await planRefusal(workspaceId);
  if (refusal) return json(refusal, refusal.status);
  const body = (await req.json().catch(() => ({}))) as { meetingId?: unknown; locale?: unknown };
  return database().transaction(async (tx) => {
    const meeting = await lockedMeeting(tx, workspaceId, body.meetingId);
    // Not invited reads the same as not found: the meeting's existence is nobody else's business.
    if (!meeting || !invitedTo(meeting, { role, userId: user.userId, clientId: member.client_id })) return json({ error: 'Réunion introuvable.' }, 404);
    const phase = meetingPhase(meeting);
    if (phase === 'cancelled') return json({ error: 'Cette réunion a été annulée.' }, 409);
    if (phase === 'over') return json({ error: 'Cette réunion est terminée.' }, 409);
    // Those who plan meetings may open the room early (to test); everyone else from 30 minutes before.
    const planner = canPlanMeetings(role);
    if (phase === 'upcoming' && !planner) return json({ error: `La réunion ouvre ${meetingLimits.earlyJoinMinutes} minutes avant l’heure prévue.` }, 409);
    if (meeting.link) return json({ provider: 'link', url: meeting.link });
    if (!dailyConfigured()) return json({ error: 'Les appels ne sont pas encore activés (DAILY_API_KEY). Ajoutez un lien de réunion ou activez Daily.' }, 503);
    // Daily bills each participant's minutes: a company's plan counts the meeting's planned length once
    // per person and meeting (rejoining is free). A pasted Meet or Zoom link (above) costs nothing.
    if (!(await countUsage(workspaceId, 'meetingMinutesPerMonth', meeting.duration ?? 60, { once: `meeting:${meeting.id}:${user.userId}` }))) {
      const refusal = meterRefusal('meetingMinutesPerMonth');
      return json(refusal, refusal.status);
    }
    const until = new Date(meetingEnd(meeting)!.getTime() + meetingLimits.lateJoinMinutes * 60_000);
    const link = await joinLink({
      meetingId: meeting.id, until, userId: user.userId, userName: user.fullName || user.displayName.split('@')[0],
      owner: planner, audioOnly: meeting.callMode === 'audio', locale: typeof body.locale === 'string' ? body.locale : undefined,
    });
    return 'error' in link ? json({ error: link.error }, 502) : json({ provider: 'daily', url: link.url, canEnd: planner });
  });
}
