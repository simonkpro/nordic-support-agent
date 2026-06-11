import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';
import { requireWorkspace, resetOnboarding } from '../lib/workspace-auth';

/**
 * Clears Workspace.onboardingCompletedAt and routes the user back to
 * the first step. Used by the "Kör onboarding igen" link in the
 * dashboard sidebar — handy when a merchant wants to walk a teammate
 * through setup or rebuild their persona from scratch.
 */

const reset = async (request: Request) => {
  const { workspace } = await requireWorkspace(request);
  await resetOnboarding(workspace.id);
  return redirect('/onboarding/welcome');
};

export const action = ({ request }: ActionFunctionArgs) => reset(request);
export const loader = ({ request }: LoaderFunctionArgs) => reset(request);
