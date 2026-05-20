import { redirect } from 'react-router';

/**
 * Bare /onboarding lands on Step 1. We don't render anything here —
 * each step has its own URL so direct links and back/forward work.
 */
export const loader = () => {
  throw redirect('/onboarding/welcome');
};
