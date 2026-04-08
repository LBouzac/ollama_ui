const DEFAULT_BASE_URL = '/api'

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

export function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  const candidate = value?.trim() || DEFAULT_BASE_URL
  return trimTrailingSlash(candidate)
}

function resolveUrl(baseUrl, path) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return `${normalizedBaseUrl}${normalizedPath}`
}

async function readErrorMessage(response) {
  const contentType = response.headers.get('content-type') || ''
  const fallbackMessage = `${response.status} ${response.statusText}`.trim()

  try {
    if (contentType.includes('application/json')) {
      const payload = await response.json()
      return payload?.error || payload?.message || fallbackMessage
    }

    const text = (await response.text()).trim()
    return text || fallbackMessage
  } catch {
    return fallbackMessage
  }
}

export async function fetchOllamaModels(baseUrl = DEFAULT_BASE_URL) {
  const response = await fetch(resolveUrl(baseUrl, '/tags'))

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  const payload = await response.json()
  const models = Array.isArray(payload?.models)
    ? payload.models
        .map((model) => model?.name)
        .filter((name) => typeof name === 'string' && name.trim().length > 0)
    : []

  return {
    models,
    raw: payload,
  }
}

async function readJsonLinesStream(response, onChunk) {
  const reader = response.body?.getReader()

  if (!reader) {
    throw new Error('Le navigateur ne prend pas en charge le flux de réponse.')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() || ''

    for (const part of parts) {
      const line = part.trim()
      if (!line) continue

      const payload = JSON.parse(line)
      if (payload?.error) {
        throw new Error(payload.error)
      }

      onChunk(payload)
    }
  }

  const trailingLine = buffer.trim()
  if (trailingLine) {
    const payload = JSON.parse(trailingLine)
    if (payload?.error) {
      throw new Error(payload.error)
    }
    onChunk(payload)
  }
}

export async function streamOllamaChat(
  {
    baseUrl = DEFAULT_BASE_URL,
    model,
    messages,
    options,
    signal,
  },
  onChunk,
) {
  const response = await fetch(resolveUrl(baseUrl, '/chat'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options,
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(await readErrorMessage(response))
  }

  await readJsonLinesStream(response, onChunk)
}

