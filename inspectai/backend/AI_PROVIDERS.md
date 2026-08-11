# AI provider configuration

The backend keeps provider-specific SDK and HTTP details behind `src/lib/ai/provider.ts`. The application never receives provider keys from the browser and never stores them in the database.

Set these backend environment variables:

```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

Or use OpenAI:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o
```

Only the selected provider is initialized. Placeholder keys are rejected with a clear `503` configuration response, and upstream failures are returned without exposing credentials or provider response bodies.

Run the provider contract tests with:

```bash
npm test
```

The tests use a mocked HTTP transport, so they do not require an API key or make paid requests.
