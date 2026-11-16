import { useEffect, useRef, useState } from 'react'
import { ApiError, fetchSettings, saveSettingsStep, submitSettings, type Account } from '../api.ts'
import {
  AUTOSAVE_DELAY_MS,
  clientValidate,
  samePayload,
  settingsFromApi,
  STEPS,
  toApiPayload,
  type StepValues,
} from '../lib/settingsSchema.ts'

interface Props {
  account: Account
  onClose: () => void
}

type StepStatus = 'idle' | 'saving' | 'saved' | 'error'

export function SettingsModal({ account, onClose }: Props) {
  const [step, setStep] = useState(0)
  const [values, setValues] = useState<Record<number, StepValues>>({})
  const [serverValues, setServerValues] = useState<Record<number, StepValues>>({})
  const [savedSteps, setSavedSteps] = useState<Set<number>>(new Set())
  const [stepStatus, setStepStatus] = useState<Record<number, StepStatus>>({})
  const [stepErrors, setStepErrors] = useState<Record<number, Record<string, string>>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingDraft, setLoadingDraft] = useState(true)
  const [submitMessage, setSubmitMessage] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [dirtySteps, setDirtySteps] = useState<Set<number>>(new Set())

  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstFieldRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchSettings(account.id)
      .then((settings) => {
        if (cancelled) return
        const restored = settingsFromApi(settings as Record<string, Record<string, unknown>>)
        setValues(restored.values)
        setServerValues(restored.values)
        setSavedSteps(new Set(restored.savedSteps))
        setLoadingDraft(false)
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof ApiError ? `Failed to load settings (${error.status})` : 'Network error',
          )
          setLoadingDraft(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [account.id])

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [step, loadingDraft])

  const setFieldValue = (key: string, value: string) => {
    const stepNumber = step + 1
    setValues((previous) => ({ ...previous, [stepNumber]: { ...previous[stepNumber], [key]: value } }))
    setStepErrors((previous) => {
      if (!previous[stepNumber]?.[key]) return previous
      const next = { ...previous, [stepNumber]: { ...previous[stepNumber] } }
      delete next[stepNumber]?.[key]
      return next
    })
    setDirtySteps((previous) => new Set(previous).add(stepNumber))
  }

  const saveStep = async (stepIndex: number): Promise<boolean> => {
    const stepNumber = stepIndex + 1
    const stepValues = values[stepNumber] ?? {}
    const errors = clientValidate(stepIndex, stepValues)
    if (Object.keys(errors).length > 0) {
      setStepErrors((previous) => ({ ...previous, [stepNumber]: errors }))
      return false
    }
    setStepStatus((previous) => ({ ...previous, [stepNumber]: 'saving' }))
    try {
      await saveSettingsStep(account.id, stepNumber, toApiPayload(stepIndex, stepValues))
      setStepStatus((previous) => ({ ...previous, [stepNumber]: 'saved' }))
      setStepErrors((previous) => ({ ...previous, [stepNumber]: {} }))
      setSavedSteps((previous) => new Set(previous).add(stepNumber))
      setDirtySteps((previous) => {
        const next = new Set(previous)
        next.delete(stepNumber)
        return next
      })
      setServerValues((previous) => ({ ...previous, [stepNumber]: stepValues }))
      return true
    } catch (error) {
      setStepStatus((previous) => ({ ...previous, [stepNumber]: 'error' }))
      const detail =
        error instanceof ApiError && error.detail && typeof error.detail === 'object'
          ? (error.detail as Record<string, unknown>)
          : null
      const fieldErrors = detail?.errors as Record<string, string> | undefined
      setStepErrors((previous) => ({
        ...previous,
        [stepNumber]:
          fieldErrors && typeof fieldErrors === 'object'
            ? fieldErrors
            : { form: 'Save failed. Please try again.' },
      }))
      return false
    }
  }

  const saveStepRef = useRef(saveStep)
  useEffect(() => {
    saveStepRef.current = saveStep
  })

  useEffect(() => {
    if (loadingDraft || !dirtySteps.has(step + 1)) return
    const timer = setTimeout(() => void saveStepRef.current(step), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [values, step, loadingDraft, dirtySteps])

  const goToStep = (next: number) => {
    setSubmitMessage(null)
    setStep(Math.min(3, Math.max(0, next)))
  }

  const handleNext = async () => {
    const ok = await saveStep(step)
    if (ok) {
      goToStep(step + 1)
      return
    }
    const stepNumber = step + 1
    const unchanged =
      serverValues[stepNumber] !== undefined &&
      samePayload(
        toApiPayload(step, values[stepNumber] ?? {}),
        toApiPayload(step, serverValues[stepNumber]),
      )
    if (unchanged && savedSteps.has(stepNumber)) {
      setSubmitMessage(
        `The server refused to re-save step ${stepNumber}, but your earlier save is still intact. You can continue.`,
      )
      goToStep(step + 1)
    }
  }

  const handleSubmit = async () => {
    setSubmitMessage(null)
    try {
      await submitSettings(account.id)
      setSubmitted(true)
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && error.detail) {
        const missing = extractMissingSteps(error.detail)
        if (missing.length > 0) {
          setSubmitMessage(
            `Cannot submit yet. These steps still need a successful save: ${missing.join(', ')}.`,
          )
          const firstMissing = Number(missing[0])
          if (Number.isInteger(firstMissing)) setStep(firstMissing - 1)
          return
        }
      }
      setSubmitMessage('Submit failed. Please try again.')
    }
  }

  const stepNumber = step + 1
  const currentStatus = stepStatus[stepNumber] ?? 'idle'
  const currentErrors = stepErrors[stepNumber] ?? {}

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby="settings-title"
      className="m-auto max-h-[90vh] w-full max-w-lg rounded-lg bg-white p-4 text-slate-900 shadow-xl backdrop:bg-slate-900/50 sm:p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id="settings-title" className="text-lg font-semibold text-slate-900">
            Settings — {account.name}
          </h2>
          <ol className="mt-1 flex flex-wrap gap-1 text-xs" aria-label="Steps">
            {STEPS.map((entry, index) => {
              const number = index + 1
              const isSaved = savedSteps.has(number) && !dirtySteps.has(number)
              return (
                <li key={number}>
                  <button
                    type="button"
                    onClick={() => goToStep(index)}
                    className={`rounded-full px-2 py-0.5 ${
                      index === step
                        ? 'bg-blue-600 text-white'
                        : isSaved
                          ? 'bg-green-100 text-green-800 hover:bg-green-200'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {index + 1}. {entry.title}
                    {isSaved ? ' ✓' : ''}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100"
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>

      {loadError && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p role="alert">{loadError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded border border-amber-400 px-2 py-1 text-xs font-medium hover:bg-amber-100"
          >
            Retry (reloads page)
          </button>
        </div>
      )}

      {submitted ? (
        <div className="rounded border border-green-300 bg-green-50 p-4 text-sm text-green-900" role="status">
          <p className="font-medium">Settings submitted successfully.</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-3 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      ) : (
        <>
          <h3 className="mb-3 text-sm font-medium text-slate-700">
            Step {stepNumber} of 4 — {STEPS[step]?.title}
          </h3>

          {loadingDraft ? (
            <div className="space-y-2 py-4">
              {[...Array(2)].map((_, index) => (
                <div key={index} className="h-9 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {(STEPS[step]?.fields ?? []).map((field, fieldIndex) => {
                const value = values[stepNumber]?.[field.key] ?? ''
                const error = currentErrors[field.key]
                const errorId = `step-${stepNumber}-${field.key}-error`
                return (
                  <div key={field.key}>
                    <label
                      htmlFor={`step-${stepNumber}-${field.key}`}
                      className="block text-sm font-medium text-slate-700"
                    >
                      {field.label}
                      {field.required && <span className="text-red-600"> *</span>}
                    </label>
                    {field.type === 'select' ? (
                      <select
                        id={`step-${stepNumber}-${field.key}`}
                        ref={
                          fieldIndex === 0
                            ? (el) => {
                                firstFieldRef.current = el
                              }
                            : undefined
                        }
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={value}
                        onChange={(event) => setFieldValue(field.key, event.target.value)}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                      >
                        <option value="">Select…</option>
                        {field.options?.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={`step-${stepNumber}-${field.key}`}
                        ref={
                          fieldIndex === 0
                            ? (el) => {
                                firstFieldRef.current = el
                              }
                            : undefined
                        }
                        type={field.type === 'number' ? 'text' : field.type}
                        inputMode={field.type === 'number' ? 'numeric' : undefined}
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        value={value}
                        placeholder={field.placeholder}
                        onChange={(event) => setFieldValue(field.key, event.target.value)}
                        aria-invalid={Boolean(error)}
                        aria-describedby={error ? errorId : undefined}
                      />
                    )}
                    {field.help && !error && (
                      <p className="mt-0.5 text-xs text-slate-500">{field.help}</p>
                    )}
                    {error && (
                      <p id={errorId} role="alert" className="mt-0.5 text-xs font-medium text-red-700">
                        {error}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <p className="mt-2 min-h-5 text-xs" aria-live="polite">
            {currentStatus === 'saving' && <span className="text-slate-500">Saving…</span>}
            {currentStatus === 'saved' && !dirtySteps.has(stepNumber) && (
              <span className="text-green-700">Saved ✓</span>
            )}
            {currentStatus === 'error' && (
              <span className="text-red-700">
                Not saved — fix the error above
                {dirtySteps.has(stepNumber) ? ' (autosaving again)' : ''}
              </span>
            )}
          </p>

          {submitMessage && (
            <p
              role="alert"
              className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900"
            >
              {submitMessage}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => goToStep(step - 1)}
              disabled={step === 0}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40"
            >
              Back
            </button>
            <div className="flex flex-wrap items-center gap-2">
              {step < 3 ? (
                <button
                  type="button"
                  onClick={() => void handleNext()}
                  className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  className="rounded bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  Submit
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </dialog>
  )
}

function extractMissingSteps(detail: unknown): string[] {
  if (detail && typeof detail === 'object' && Array.isArray((detail as Record<string, unknown>).missing_steps)) {
    return ((detail as Record<string, unknown>).missing_steps as unknown[]).map(String)
  }
  if (typeof detail === 'string') {
    return detail.match(/\d+/g) ?? []
  }
  return []
}
