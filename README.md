# Ollama UI locale

Application Vue 3 + Vite pour discuter avec un modèle [Ollama](https://ollama.com/) exécuté sur la machine locale.

## Prérequis

- Node.js 20+
- Ollama installé et lancé localement
- Un modèle téléchargé, par exemple `llama3.2`

```bash
ollama pull llama3.2
```

## Installation

```bash
npm install
```

## Lancer l’interface

L’interface appelle par défaut `/api`, et `vite.config.js` redirige cette route vers `http://127.0.0.1:11434`.

```bash
npm run dev
```

Ensuite, ouvre l’URL affichée par Vite.

## Utilisation

1. Vérifie qu’Ollama tourne en local.
2. Lance `npm run dev`.
3. Renseigne le modèle dans l’interface si besoin.
4. Ajoute si besoin des fichiers `.txt`, `.md`, `.json`, `.csv`, `.docx`, `.png`, `.jpg`, `.jpeg` ou `.webp`.
5. Envoie ton message avec <kbd>Entrée</kbd>.

Les fichiers texte et Word `.docx` sont convertis en texte et injectés dans le contexte du modèle. Les images sont envoyées au format vision d’Ollama, si le modèle choisi le supporte.

> Remarque : les anciens fichiers Word `.doc` ne sont pas gérés directement dans le navigateur. Il faut les convertir en `.docx` avant l’envoi.

## Configuration alternative

Si tu veux pointer vers une autre API Ollama, change l’adresse dans l’UI ou définis la variable d’environnement suivante avant de lancer Vite :

```bash
VITE_OLLAMA_BASE_URL=http://127.0.0.1:11434/api npm run dev
```

## Production

```bash
npm run build
```

Le build reste statique ; pour une mise en production, assure-toi qu’un proxy ou que la variable `VITE_OLLAMA_BASE_URL` pointe bien vers l’instance Ollama disponible.

## Limites utiles

- Les gros fichiers texte sont tronqués avant d’être envoyés au modèle.
- Les images lourdes peuvent être refusées pour éviter de surcharger le contexte.
- Pour les images, utilise un modèle multimodal Ollama.

