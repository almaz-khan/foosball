import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Server code and the Bun CLI both read process.env; Vite only exposes .env as
  // import.meta.env. Load it into process.env too, never overriding the real environment.
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    process.env[k] ??= v;
  }

  // The login hub sends people back to FOOSBALL_ORIGIN; Vite must accept its hostname as a Host header.
  const origin = process.env.FOOSBALL_ORIGIN;
  const allowedHosts = origin ? [new URL(origin).hostname] : [];

  return {
    plugins: [sveltekit({ adapter: adapter() })],
    server: { host: '127.0.0.1', port: 5180, strictPort: true, allowedHosts },
    preview: { host: '127.0.0.1', port: 5180, strictPort: true, allowedHosts },
    ssr: { external: ['postgres'] },
  };
});
