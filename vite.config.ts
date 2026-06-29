import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { svelteTesting } from '@testing-library/svelte/vite'

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
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
