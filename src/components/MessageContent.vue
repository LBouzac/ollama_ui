<script setup>
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

const props = defineProps({
  content: {
    type: String,
    default: '',
  },
})

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function normalizeLanguage(language) {
  return language
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_+-]/g, '')
}

function renderHighlightedCode(code, language) {
  const normalizedLanguage = normalizeLanguage(language || '')
  const languageLabel = language?.trim() || 'code'
  const highlightedCode = normalizedLanguage && hljs.getLanguage(normalizedLanguage)
    ? hljs.highlight(code, {
        language: normalizedLanguage,
        ignoreIllegals: true,
      }).value
    : hljs.highlightAuto(code).value || escapeHtml(code)

  return [
    '<div class="code-block">',
    `<div class="code-block__header">${escapeHtml(languageLabel)}</div>`,
    `<pre><code class="hljs language-${escapeHtml(normalizedLanguage || 'plaintext')}">${highlightedCode}</code></pre>`,
    '</div>',
  ].join('')
}

const markdown = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
  highlight: renderHighlightedCode,
})

const renderedContent = computed(() => markdown.render(props.content || ''))
</script>

<template>
  <div class="message-content" v-html="renderedContent" />
</template>

