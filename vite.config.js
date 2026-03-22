import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = env.BILLING_API_PORT || '8787'
  const billingProxy = {
    '/api/billing': {
      target: `http://localhost:${apiPort}`,
      changeOrigin: true,
    },
  }

  return {
    plugins: [react()],
    server: { proxy: billingProxy },
    preview: { proxy: billingProxy },
  }
})
