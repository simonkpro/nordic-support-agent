import type { Config } from '@react-router/dev/config';
import { vercelPreset } from '@vercel/react-router/vite';

// The Vercel preset only changes the build output when building on Vercel
// (it detects the VERCEL env var), so local `react-router build` / Docker
// builds are unaffected.
export default {
  ssr: true,
  presets: [vercelPreset()],
} satisfies Config;
