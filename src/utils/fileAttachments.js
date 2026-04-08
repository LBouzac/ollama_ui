const MAX_TEXT_ATTACHMENT_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024
const MAX_EXCERPT_LENGTH = 1200
const MAX_CONTEXT_TEXT_LENGTH = 40000

let mammothModulePromise

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json', 'js', 'ts', 'vue', 'html', 'css', 'py', 'java', 'c', 'cpp', 'rb', 'go', 'rs'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])

function fileNameExtension(fileName) {
  const parts = fileName.toLowerCase().split('.')
  return parts.length > 1 ? parts.pop() : ''
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes} o`
  }

  const units = ['Ko', 'Mo', 'Go']
  let value = bytes / 1024
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

function readAsText(file) {
  return file.text()
}

function readAsArrayBuffer(file) {
  return file.arrayBuffer()
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Impossible de lire le fichier image.'))
    reader.readAsDataURL(file)
  })
}

async function loadMammoth() {
  if (!mammothModulePromise) {
    mammothModulePromise = import('mammoth/mammoth.browser')
  }

  const mammothModule = await mammothModulePromise
  return mammothModule.default ?? mammothModule
}

function toAttachmentId(file) {
  return `${file.name}-${file.size}-${file.lastModified}`
}

function buildExcerpt(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > MAX_EXCERPT_LENGTH ? `${normalized.slice(0, MAX_EXCERPT_LENGTH)}…` : normalized
}

function buildContextText(name, text, kind) {
  const contextLabel = kind === 'docx' ? 'document Word' : 'fichier texte'
  const safeText = text.slice(0, MAX_CONTEXT_TEXT_LENGTH)
  const truncatedNotice = text.length > MAX_CONTEXT_TEXT_LENGTH ? '\n[Contenu tronqué]' : ''

  return [
    `[${contextLabel}: ${name}]`,
    safeText,
    truncatedNotice,
  ]
    .filter(Boolean)
    .join('\n')
}

function detectAttachmentKind(file) {
  const extension = fileNameExtension(file.name)
  const normalizedMime = (file.type || '').toLowerCase()

  if (extension === 'docx' || normalizedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return 'docx'
  }

  if (TEXT_EXTENSIONS.has(extension) || normalizedMime.startsWith('text/') || normalizedMime === 'application/json') {
    return 'text'
  }

  if (IMAGE_EXTENSIONS.has(extension) || normalizedMime.startsWith('image/')) {
    return 'image'
  }

  if (extension === 'doc') {
    return 'legacy-doc'
  }

  return 'unsupported'
}

export function getSupportedAttachmentHint() {
  return 'Fichiers acceptés : .txt, .md, .json, .csv, .docx, .png, .jpg, .jpeg, .webp. Les .doc ne sont pas pris en charge dans le navigateur.'
}

export async function parseAttachmentFile(file) {
  const kind = detectAttachmentKind(file)
  const extension = fileNameExtension(file.name)

  if (kind === 'legacy-doc') {
    throw new Error(`Le format .doc n’est pas pris en charge dans le navigateur. Convertis ${file.name} en .docx.`)
  }

  if (kind === 'unsupported') {
    throw new Error(`Type de fichier non supporté : ${file.name}`)
  }

  if ((kind === 'text' || kind === 'docx') && file.size > MAX_TEXT_ATTACHMENT_BYTES) {
    throw new Error(`Le fichier ${file.name} est trop volumineux pour être injecté dans le contexte.`)
  }

  if (kind === 'image' && file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new Error(`L’image ${file.name} est trop volumineuse pour être envoyée au modèle.`)
  }

  if (kind === 'docx') {
    const mammoth = await loadMammoth()
    const result = await mammoth.extractRawText({ arrayBuffer: await readAsArrayBuffer(file) })
    const text = (result.value || '').trim()

    return {
      id: toAttachmentId(file),
      name: file.name,
      kind,
      label: 'Word',
      mimeType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: file.size,
      sizeLabel: formatBytes(file.size),
      text,
      excerpt: buildExcerpt(text),
      contextText: buildContextText(file.name, text, kind),
      truncated: text.length > MAX_CONTEXT_TEXT_LENGTH,
    }
  }

  if (kind === 'text') {
    const text = (await readAsText(file)).trim()

    return {
      id: toAttachmentId(file),
      name: file.name,
      kind,
      label: extension ? extension.toUpperCase() : 'Texte',
      mimeType: file.type || 'text/plain',
      size: file.size,
      sizeLabel: formatBytes(file.size),
      text,
      excerpt: buildExcerpt(text),
      contextText: buildContextText(file.name, text, kind),
      truncated: text.length > MAX_CONTEXT_TEXT_LENGTH,
    }
  }

  const dataUrl = await readAsDataUrl(file)
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : ''

  return {
    id: toAttachmentId(file),
    name: file.name,
    kind,
    label: 'Image',
    mimeType: file.type || 'image/png',
    size: file.size,
    sizeLabel: formatBytes(file.size),
    previewDataUrl: dataUrl,
    base64,
    excerpt: 'Image prête à être envoyée au modèle vision.',
  }
}

export function describeAttachment(attachment) {
  const suffix = attachment.truncated ? ' · tronqué' : ''
  return `${attachment.label} · ${attachment.sizeLabel}${suffix}`
}

export function buildOllamaMessagePayload(message) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  const images = []
  const contextBlocks = []

  for (const attachment of attachments) {
    if (attachment.kind === 'image' && attachment.base64) {
      images.push(attachment.base64)
      continue
    }

    if (attachment.contextText) {
      contextBlocks.push(attachment.contextText)
    }
  }

  const promptText = (message.content || '').trim()
  const content = [
    promptText,
    contextBlocks.length > 0 ? 'Fichiers joints :' : '',
    ...contextBlocks,
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim() || (images.length > 0 ? 'Analyse l’image ci-jointe.' : '')

  const payload = {
    role: message.role,
    content,
  }

  if (images.length > 0) {
    payload.images = images
  }

  return payload
}

