import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';
import { requirePlatformAdmin, stopImpersonation } from '../lib/workspace-auth.ts';

/** Exit "view as workspace". Loader variant exists so the banner can be
 * a plain link (mirrors auth.signout.tsx). */

const stop = async (request: Request) => {
  const session = await requirePlatformAdmin(request);
  await stopImpersonation(session.id, session.user);
  return redirect('/admin');
};

export const action = ({ request }: ActionFunctionArgs) => stop(request);
export const loader = ({ request }: LoaderFunctionArgs) => stop(request);
