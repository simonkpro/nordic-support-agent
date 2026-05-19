import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';
import { buildSignOutCookie, destroySession } from '../lib/workspace-auth.ts';

const signOut = async (request: Request) => {
  await destroySession(request);
  return redirect('/signin', {
    headers: { 'Set-Cookie': buildSignOutCookie() },
  });
};

export const action = ({ request }: ActionFunctionArgs) => signOut(request);
export const loader = ({ request }: LoaderFunctionArgs) => signOut(request);
