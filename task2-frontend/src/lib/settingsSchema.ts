export interface StepField {
  key: string
  label: string
  type: 'text' | 'email' | 'number' | 'url' | 'select'
  required: boolean
  options?: { value: string; label: string }[]
  placeholder?: string
  help?: string
}

export interface StepDefinition {
  title: string
  fields: StepField[]
}

export const AUTOSAVE_DELAY_MS = 800

export const STEPS: StepDefinition[] = [
  {
    title: 'Account details',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Jane Doe' },
      {
        key: 'email',
        label: 'Email',
        type: 'email',
        required: true,
        placeholder: 'jane@example.com',
        help: 'Must contain an @.',
      },
    ],
  },
  {
    title: 'Plan and billing',
    fields: [
      {
        key: 'plan',
        label: 'Plan',
        type: 'select',
        required: true,
        options: [
          { value: 'basic', label: 'Basic' },
          { value: 'pro', label: 'Pro' },
          { value: 'enterprise', label: 'Enterprise' },
        ],
      },
      {
        key: 'billing_country',
        label: 'Billing country',
        type: 'select',
        required: true,
        options: [
          { value: 'US', label: 'United States' },
          { value: 'IN', label: 'India' },
          { value: 'GB', label: 'United Kingdom' },
          { value: 'CA', label: 'Canada' },
          { value: 'AU', label: 'Australia' },
        ],
      },
    ],
  },
  {
    title: 'Usage caps',
    fields: [
      {
        key: 'minutes_cap',
        label: 'Minutes cap',
        type: 'number',
        required: false,
        help: 'Optional. Leave empty for no cap.',
      },
      {
        key: 'sms_cap',
        label: 'SMS cap',
        type: 'number',
        required: false,
        help: 'Optional. Leave empty for no cap.',
      },
    ],
  },
  {
    title: 'Webhook',
    fields: [
      {
        key: 'webhook_url',
        label: 'Webhook URL',
        type: 'url',
        required: false,
        placeholder: 'https://example.com/hooks/calls',
        help: 'Optional. Must start with http:// or https://.',
      },
    ],
  },
]

export type StepValues = Record<string, string>

function stepFields(stepIndex: number): StepField[] {
  return STEPS[stepIndex]?.fields ?? []
}

export function clientValidate(stepIndex: number, values: StepValues): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of stepFields(stepIndex)) {
    const value = (values[field.key] ?? '').trim()
    if (field.required && !value) {
      errors[field.key] = `${field.label} is required`
      continue
    }
    if (field.key === 'email' && value && !value.includes('@')) {
      errors[field.key] = 'Email must contain an @'
    }
    if (field.type === 'number' && value && !/^\d+$/.test(value)) {
      errors[field.key] = `${field.label} must be a whole number`
    }
    if (field.key === 'webhook_url' && value && !/^https?:\/\//.test(value)) {
      errors[field.key] = 'Webhook URL must start with http:// or https://'
    }
  }
  return errors
}

export function toApiPayload(stepIndex: number, values: StepValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  for (const field of stepFields(stepIndex)) {
    const value = (values[field.key] ?? '').trim()
    if (!value) continue
    payload[field.key] = field.type === 'number' ? Number(value) : value
  }
  return payload
}

export function samePayload(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function settingsFromApi(
  raw: Record<string, Record<string, unknown>>,
): {
  values: Record<number, StepValues>
  savedSteps: number[]
} {
  const values: Record<number, StepValues> = {}
  const savedSteps: number[] = []
  for (const key of Object.keys(raw)) {
    const stepNumber = Number(key)
    if (!Number.isInteger(stepNumber) || !STEPS[stepNumber - 1]) continue
    savedSteps.push(stepNumber)
    const entry: StepValues = {}
    for (const field of stepFields(stepNumber - 1)) {
      const value = raw[key]?.[field.key]
      if (value !== undefined && value !== null) entry[field.key] = String(value)
    }
    values[stepNumber] = entry
  }
  return { values, savedSteps: savedSteps.sort((a, b) => a - b) }
}
