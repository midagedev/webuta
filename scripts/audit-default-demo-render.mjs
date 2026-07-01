#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { smokeBrowserRender } from './smoke-browser-render.mjs'

export const DEFAULT_REPORT = 'experiments/utau-v3/work/default-demo-render-audit.json'

const REQUIRED_CHECKS = [
  'default V3 voicebank loaded',
  'first-run starter guide visible',
  'first-run quick-start CTA visible',
  'first-run focused next action visible',
  'first-run starter route visible',
  'first-run inline lyric input visible',
  'first-run current lyric card visible',
  'first-run action route visible',
  'first-run sketch cues visible',
  'tempo map controls visible',
  'Korean mode navigation visible',
  'first-run demo aliases fully matched',
  'first-run demo render warnings clear',
  'first-run lyric visible',
  'community release readiness card visible',
  'voicebank license metadata visible',
  'voicebank self-generated origin visible',
  'selected-note dynamics controls visible',
  'selected-note resampler controls visible',
  'selected-note timing controls visible',
  'selected-note envelope controls visible',
  'selected-note vibrato controls visible',
  'selected-note pitch bend controls visible',
  'selected-note duplicate controls visible',
  'classic UST import/export controls visible',
  'community listening review scorecard linked',
  'selected-note UTAU sample preview available',
  'desktop WAV download',
  'render history visible',
  'desktop no page horizontal overflow',
  'desktop piano keyboard and bar ruler visible',
  'mobile export controls visible',
  'mobile touch keyboard visible',
  'mobile piano keyboard and bar ruler visible',
  'mobile no page horizontal overflow',
]

const DEFAULT_THRESHOLDS = {
  minDurationSeconds: 5,
  maxDurationSeconds: 10,
  minBytes: 400_000,
}

export async function auditDefaultDemoRender(options = {}) {
  const smoke = await smokeBrowserRender({
    ...options,
    out: undefined,
    requireDefaultV3: true,
  })
  const report = summarizeDefaultDemoSmoke(smoke, options.thresholds)
  if (options.report) {
    writeJson(resolve(options.report), report)
  }
  return report
}

export function summarizeDefaultDemoSmoke(smoke, thresholdOverrides = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...thresholdOverrides }
  const checks = new Set(Array.isArray(smoke?.checks) ? smoke.checks : [])
  const wav = smoke?.download?.wav ?? {}
  const missingChecks = REQUIRED_CHECKS.filter((check) => !checks.has(check))
  const problems = [
    ...(smoke?.ok ? [] : ['browser smoke did not report ok=true']),
    ...(smoke?.mode === 'static' ? [] : [`expected static UTAU mode, got ${smoke?.mode ?? 'unknown'}`]),
    ...missingChecks.map((check) => `missing smoke check: ${check}`),
    ...(wav.sampleRate === 44100 ? [] : [`WAV sampleRate ${wav.sampleRate}; expected 44100`]),
    ...(wav.channels === 1 ? [] : [`WAV channels ${wav.channels}; expected mono`]),
    ...(wav.bitsPerSample === 16 ? [] : [`WAV bitsPerSample ${wav.bitsPerSample}; expected 16`]),
    ...(wav.durationSeconds >= thresholds.minDurationSeconds && wav.durationSeconds <= thresholds.maxDurationSeconds
      ? []
      : [
          `WAV duration ${Number(wav.durationSeconds ?? 0).toFixed(3)}s outside ${thresholds.minDurationSeconds}..${thresholds.maxDurationSeconds}s`,
        ]),
    ...(wav.bytes >= thresholds.minBytes ? [] : [`WAV bytes ${wav.bytes ?? 0}; expected at least ${thresholds.minBytes}`]),
    ...(String(smoke?.download?.fileName ?? '').endsWith('.wav')
      ? []
      : [`download fileName ${smoke?.download?.fileName ?? 'unknown'} is not a WAV`]),
  ]

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    ok: problems.length === 0,
    decision: problems.length === 0 ? 'default-demo-render-pass' : 'default-demo-render-fail',
    thresholds,
    requiredChecks: REQUIRED_CHECKS.map((check) => ({
      check,
      passed: checks.has(check),
    })),
    download: smoke?.download ?? null,
    smoke: {
      mode: smoke?.mode ?? null,
      url: smoke?.url ?? null,
      checks: Array.isArray(smoke?.checks) ? smoke.checks : [],
    },
    problems,
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function parseArgs(argv) {
  const options = {
    report: DEFAULT_REPORT,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--url') {
      options.url = argv[++index]
    } else if (arg === '--report' || arg === '--out') {
      options.report = argv[++index]
    } else if (arg === '--port') {
      options.port = Number(argv[++index])
    } else if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--help') {
      console.log(
        [
          'Usage: node scripts/audit-default-demo-render.mjs [options]',
          '',
          'Options:',
          '  --url url       Use an already-running WebUtau URL instead of starting Vite',
          '  --report path   JSON report path',
          '  --port n        Port for the temporary Vite server',
          '  --headed        Run Chromium with a visible window',
        ].join('\n'),
      )
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  auditDefaultDemoRender(parseArgs(process.argv.slice(2)))
    .then((report) => {
      console.log(JSON.stringify(report, null, 2))
      if (!report.ok) {
        process.exit(1)
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error))
      process.exit(1)
    })
}
