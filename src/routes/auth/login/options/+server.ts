import { loginOptions } from '#foosball/auth.ts';
import { webauthn } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => Response.json(await loginOptions(webauthn()));
