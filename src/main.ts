import { mount } from 'svelte'
import './index.css'
import App from './App.svelte'
import { registerPwa } from './pwa.ts'

mount(App, {
  target: document.getElementById('root')!,
})

registerPwa()
