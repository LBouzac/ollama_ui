<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { fetchOllamaModels, normalizeBaseUrl, streamOllamaChat } from '@/services/ollama.js'
import MessageContent from './components/MessageContent.vue'
import {
  buildOllamaMessagePayload,
  describeAttachment,
  getSupportedAttachmentHint,
  parseAttachmentFile,
} from '@/utils/fileAttachments.js'

const STORAGE_KEYS = {
  baseUrl: 'ollama-ui-base-url',
  model: 'ollama-ui-model',
}

const browserStorage = typeof window !== 'undefined' ? window.localStorage : null

function readStoredValue(key, fallback) {
  return browserStorage?.getItem(key) || fallback
}

function writeStoredValue(key, value) {
  if (!browserStorage) {
    return
  }

  if (value && value.trim()) {
    browserStorage.setItem(key, value)
  } else {
    browserStorage.removeItem(key)
  }
}

let nextMessageId = 1

function createMessage(role, content) {
  return {
    id: nextMessageId++,
    role,
    content,
    attachments: [],
  }
}

const welcomeMessage = 'Pret.'

const messages = ref([createMessage('assistant', welcomeMessage)])
const prompt = ref('')
const baseUrl = ref(
  readStoredValue(STORAGE_KEYS.baseUrl, import.meta.env.VITE_OLLAMA_BASE_URL || '/api'),
)
const selectedModel = ref(readStoredValue(STORAGE_KEYS.model, ''))
const availableModels = ref([])
const isLoadingModels = ref(false)
const isSending = ref(false)
const isReadingAttachments = ref(false)
const connectionState = ref('idle')
const connectionText = ref('Pret')
const errorMessage = ref('')
const attachmentError = ref('')
const pendingAttachments = ref([])
const fileInput = ref(null)
const isDragActive = ref(false)
const chatEnd = ref(null)

const normalizedBaseUrl = computed(() => normalizeBaseUrl(baseUrl.value))
const supportedAttachmentHint = computed(() => getSupportedAttachmentHint())

const hasPendingContent = computed(() => {
  return prompt.value.trim().length > 0 || pendingAttachments.value.length > 0
})

const canSend = computed(() => {
  return (
    hasPendingContent.value &&
    selectedModel.value.trim().length > 0 &&
    !isSending.value &&
    !isReadingAttachments.value
  )
})

const statusMeta = computed(() => {
  const map = {
    idle: { label: 'En attente', tone: 'muted' },
    checking: { label: 'Vérification', tone: 'warning' },
    connected: { label: 'Connecté', tone: 'success' },
    sending: { label: 'Génération', tone: 'accent' },
    warning: { label: 'Attention', tone: 'warning' },
    offline: { label: 'Hors ligne', tone: 'danger' },
  }

  return map[connectionState.value] ?? map.idle
})

watch(baseUrl, (value) => writeStoredValue(STORAGE_KEYS.baseUrl, value))
watch(selectedModel, (value) => writeStoredValue(STORAGE_KEYS.model, value))

function setConnection(state, text) {
  connectionState.value = state
  connectionText.value = text
}

function copyAttachmentForMessage(attachment) {
  return { ...attachment }
}

function resetAttachmentState() {
  pendingAttachments.value = []
  attachmentError.value = ''
  isDragActive.value = false

  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

function openFilePicker() {
  fileInput.value?.click()
}

async function addFiles(fileList) {
  const files = Array.from(fileList || [])

  if (files.length === 0) {
    return
  }

  isReadingAttachments.value = true
  attachmentError.value = ''

  try {
    const successes = []
    const failures = []

    for (const file of files) {
      try {
        successes.push(await parseAttachmentFile(file))
      } catch (error) {
        failures.push(error instanceof Error ? error.message : `Impossible de traiter ${file.name}.`)
      }
    }

    if (successes.length > 0) {
      pendingAttachments.value = [...pendingAttachments.value, ...successes]
    }

    if (failures.length > 0) {
      attachmentError.value = failures.join(' ')
    }
  } finally {
    isReadingAttachments.value = false
  }
}

function handleFileSelection(event) {
  addFiles(event.target.files)
  event.target.value = ''
}

function handleDrop(event) {
  isDragActive.value = false
  addFiles(event.dataTransfer?.files)
}

function handleDragEnter() {
  isDragActive.value = true
}

function handleDragLeave() {
  isDragActive.value = false
}

function removeAttachment(attachmentId) {
  pendingAttachments.value = pendingAttachments.value.filter((attachment) => attachment.id !== attachmentId)
}

function clearAttachments() {
  resetAttachmentState()
}

async function scrollToBottom() {
  await nextTick()
  chatEnd.value?.scrollIntoView({ block: 'end' })
}

async function loadModels() {
  isLoadingModels.value = true
  errorMessage.value = ''
  setConnection('checking', `Connexion à ${normalizedBaseUrl.value}`)

  try {
    const { models } = await fetchOllamaModels(normalizedBaseUrl.value)
    availableModels.value = models

    if (!selectedModel.value.trim() && models.length > 0) {
      selectedModel.value = models[0]
    }

    if (models.length > 0) {
      setConnection('connected', `${models.length} modèle(s) détecté(s)`)
    } else {
      setConnection('warning', 'Aucun modele disponible')
    }
  } catch (error) {
    availableModels.value = []
    setConnection('offline', 'Connexion impossible')
    errorMessage.value = error instanceof Error ? error.message : 'Erreur inconnue lors de la connexion à Ollama.'
  } finally {
    isLoadingModels.value = false
  }
}

function handleComposerKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

async function sendMessage() {
  const content = prompt.value.trim()

  if (!hasPendingContent.value || !selectedModel.value.trim() || isSending.value || isReadingAttachments.value) {
    return
  }

  errorMessage.value = ''

  const userMessage = createMessage('user', content)
  userMessage.attachments = pendingAttachments.value.map(copyAttachmentForMessage)
  messages.value.push(userMessage)
  prompt.value = ''
  resetAttachmentState()

  const assistantMessage = createMessage('assistant', '')
  messages.value.push(assistantMessage)

  await scrollToBottom()

  const outgoingMessages = messages.value.slice(0, -1).map(buildOllamaMessagePayload)

  isSending.value = true
  setConnection('sending', `Génération avec ${selectedModel.value.trim()}`)

  try {
    await streamOllamaChat({
      baseUrl: normalizedBaseUrl.value,
      model: selectedModel.value.trim(),
      messages: outgoingMessages,
    }, (payload) => {
      const token = payload?.message?.content || ''

      if (token) {
        assistantMessage.content += token
      }

      if (payload?.done && !assistantMessage.content.trim()) {
        assistantMessage.content = 'Réponse vide reçue depuis Ollama.'
      }

      scrollToBottom()
    })

    if (!assistantMessage.content.trim()) {
      assistantMessage.content = 'Réponse vide reçue depuis Ollama.'
    }

    setConnection('connected', 'Traitement termine')
  } catch (error) {
    assistantMessage.content =
      'La reponse n a pas pu etre recuperee. Verifie la connexion locale et le modele selectionne.'
    errorMessage.value = error instanceof Error ? error.message : 'Erreur inattendue lors de l’envoi du message.'
    setConnection('offline', 'Échec de la requête vers Ollama')
  } finally {
    isSending.value = false
    await scrollToBottom()
  }
}

onMounted(loadModels)
</script>

<template>
  <div class="app-shell">
    <aside class="side-panel">
      <h1>Ollama UI</h1>

      <section class="sidebar-card status-card">
        <div class="status-row">
          <span class="status-pill" :class="`status-pill--${statusMeta.tone}`">
            {{ statusMeta.label }}
          </span>
          <span class="status-text">{{ connectionText }}</span>
        </div>
        <p class="status-copy">API : <code>{{ normalizedBaseUrl }}</code></p>
      </section>

      <section class="sidebar-card">
        <div class="sidebar-card__head">
          <h2>Modèle</h2>
          <button type="button" class="link-button" @click="loadModels" :disabled="isLoadingModels">
            {{ isLoadingModels ? '...' : 'Rafraîchir' }}
          </button>
        </div>

        <label class="field field--inline">
          <span>Choisir un modele</span>
          <select v-model="selectedModel" :disabled="availableModels.length === 0">
            <option disabled value="">
              {{ availableModels.length === 0 ? 'Aucun modele disponible' : 'Selectionner un modele' }}
            </option>
            <option v-for="model in availableModels" :key="model" :value="model">
              {{ model }}
            </option>
          </select>
        </label>
      </section>

      <details class="advanced-settings sidebar-card">
        <summary>Parametres avances</summary>
        <label class="field field--compact">
            <span>Adresse API</span>
          <input
            v-model="baseUrl"
            type="text"
            placeholder="/api ou http://localhost:11434/api"
            autocomplete="off"
          />
        </label>
        <p class="advanced-note">API active : <code>{{ normalizedBaseUrl }}</code></p>
      </details>

      <section
        class="attachments-panel sidebar-card"
        :class="{ 'attachments-panel--drag-active': isDragActive }"
        @dragenter.prevent="handleDragEnter"
        @dragover.prevent="handleDragEnter"
        @dragleave.prevent="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <input
          ref="fileInput"
          class="sr-only"
          type="file"
          multiple
          accept=".txt,.md,.json,.csv,.docx,.png,.jpg,.jpeg,.webp"
          @change="handleFileSelection"
        />

        <div class="attachments-panel__header">
          <div>
            <p class="attachments-title">Documents</p>
            <p class="attachments-hint">{{ supportedAttachmentHint }}</p>
          </div>
        </div>

        <div class="attachments-panel__actions">
          <button type="button" class="secondary-button" @click="openFilePicker">Importer</button>
          <button type="button" class="secondary-button" @click="clearAttachments" :disabled="pendingAttachments.length === 0">
            Vider
          </button>
        </div>

        <p class="attachments-dropzone-copy">Glisse-depose ici ou clique sur <strong>Importer</strong>.</p>
        <p v-if="isReadingAttachments" class="attachments-status">Preparation des fichiers...</p>
        <p v-if="attachmentError" class="attachments-error">{{ attachmentError }}</p>

        <div v-if="pendingAttachments.length > 0" class="attachments-list">
          <article v-for="attachment in pendingAttachments" :key="attachment.id" class="attachment-card">
            <div class="attachment-card__header">
              <div>
                <p class="attachment-card__name">{{ attachment.name }}</p>
                <p class="attachment-card__meta">{{ describeAttachment(attachment) }}</p>
              </div>

              <button type="button" class="attachment-card__remove" @click="removeAttachment(attachment.id)">
                Retirer
              </button>
            </div>

            <img
              v-if="attachment.kind === 'image'"
              class="attachment-card__preview"
              :src="attachment.previewDataUrl"
              :alt="attachment.name"
            />

            <p v-else class="attachment-card__excerpt">
              {{ attachment.excerpt || 'Aucun extrait disponible.' }}
            </p>
          </article>
        </div>
      </section>

    </aside>

    <main class="workspace-window">
      <section class="browser-chrome" aria-label="Statut">
        <span class="browser-chrome__model">{{ selectedModel || 'aucun modèle' }}</span>
      </section>


      <section class="chat-stream" aria-live="polite">
        <article
          v-for="message in messages"
          :key="message.id"
          class="message"
          :class="`message--${message.role}`"
        >
          <div v-if="message.attachments?.length" class="message-attachments">
            <article
              v-for="attachment in message.attachments"
              :key="attachment.id"
              class="message-attachment"
            >
              <div class="message-attachment__meta">
                <span>{{ attachment.name }}</span>
                <span>{{ describeAttachment(attachment) }}</span>
              </div>

              <img
                v-if="attachment.kind === 'image'"
                class="message-attachment__preview"
                :src="attachment.previewDataUrl"
                :alt="attachment.name"
              />

              <p v-else-if="attachment.excerpt" class="message-attachment__excerpt">
                {{ attachment.excerpt }}
              </p>
            </article>
          </div>

          <MessageContent :content="message.content" />
        </article>

        <div v-if="isSending" class="typing-indicator" aria-label="Traitement en cours">
          <span></span>
          <span></span>
          <span></span>
        </div>

        <div ref="chatEnd"></div>
      </section>

      <form class="composer" @submit.prevent="sendMessage">
        <label class="field composer-field">
          <span>Demande</span>
          <textarea
            v-model="prompt"
            rows="4"
            placeholder="Saisis ta demande..."
            @keydown="handleComposerKeydown"
          />
        </label>

        <div class="composer-actions">
          <p class="composer-help">Entree pour lancer, Maj + Entree pour une nouvelle ligne.</p>
          <button type="submit" class="primary-button" :disabled="!canSend">
            {{ isSending ? 'Traitement...' : 'Lancer' }}
          </button>
        </div>
      </form>

      <p v-if="errorMessage" class="error-banner">
        {{ errorMessage }}
      </p>
    </main>
  </div>
</template>

