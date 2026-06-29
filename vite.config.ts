import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

function githubPagesBase() {
  const repository = process.env.GITHUB_REPOSITORY
  if (!repository) {
    return '/'
  }
  const repoName = repository.split('/')[1]
  return repoName?.endsWith('.github.io') ? '/' : `/${repoName}/`
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? githubPagesBase() : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
