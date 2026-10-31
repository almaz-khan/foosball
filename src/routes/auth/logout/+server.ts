import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, deleteSession } from '#foosball/auth.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies }) => {
  const token = cookies.get(SESSION_COOKIE);
  if (token) await deleteSession(token);
  cookies.delete(SESSION_COOKIE, { path: '/' });
  redirect(303, '/login');
};
