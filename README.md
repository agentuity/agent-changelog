# Changelog Management Agent

This agent receives GitHub webhooks when releases or tags are created and automatically updates changelogs across repositories using Devin AI and LLM processing.

## Overview

The Changelog Management Agent acts as a smart bridge between GitHub webhooks and Devin AI. When a repository has a new release or tag created, this agent:

1. Receives the webhook from GitHub
2. Uses LLM processing to analyze the payload and determine event type, repository, and version
3. Dynamically generates a comprehensive prompt for Devin AI
4. Sends the prompt to Devin AI, which then handles the changelog generation
5. Monitors the response and status

## Configuration

Create a `.env` file with your Devin API key and other required configuration:

```
DEVIN_API_KEY=your_devin_api_key_here
GITHUB_WEBHOOK_SECRET=your_github_webhook_secret_here
```

## GitHub Webhook Setup

Configure a webhook in each repository with:

- Payload URL: Your deployed agent URL
- Content type: `application/json`
- Events: Releases and Tags

## LLM-Driven Approach

This agent leverages AI in multiple ways:

1. **Webhook Analysis**: Uses an LLM to parse and extract meaning from webhook payloads
2. **Prompt Generation**: Dynamically creates detailed prompts for Devin AI
3. **Structured Output**: Uses Zod schemas to ensure reliable data extraction
4. **Changelog Generation**: Delegates the actual creation to Devin AI

## Development

This agent is built using the Agentuity SDK.

```bash
# Install dependencies
bun install

# Run the agent locally
AGENTUITY_ENV=development agentuity dev
```

## Deployment

```bash
# Deploy with Agentuity
agentuity deploy
```

## How It Works

1. GitHub webhook triggers the agent when a release/tag is created
2. The LLM analyzes the webhook payload to determine:
   - If it's a valid release/tag event
   - Which repository it relates to
   - The version number
   - If the repository is supported
3. A second LLM pass generates a detailed, repository-specific prompt
4. Devin AI processes the prompt, accessing repositories and updating changelogs
5. Both the source repository and documentation repository are updated
