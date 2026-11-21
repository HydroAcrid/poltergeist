# Crowd's Gemini keys

Crowd uses two Gemini keys (`gemini-4-hydrogen`) across two server-only adapters:
1. **Creative moderation & staging (`server/moderation/gemini.ts`):** rewrites free-text guest ideas into family-safe hallway events, proposes private one-Enter revisions, and labels visual staging (`family`, `impact`, `placement`).
2. **Live show conductor (`server/conductor-agent.ts`):** ranks rule-feasible ideas for the current hallway shot within a 500 ms budget (`withAgent`), falling back deterministically to rules if slow or unavailable.

Key 1 does the work. If key 1 is rate-limited (429), rejected (401/403) or Gemini has a server error (5xx), key 2 takes over, and key 1 rests for a minute. Rolling per-minute caps protect the bill. If both keys fail or the cap is hit, moderation holds the idea back ("The idea check is unavailable…", never approved unchecked) and the conductor keeps its deterministic rule pick. The preset suggestions keep working.

## Where the keys live

A private file outside the repo, readable only by you:

```
~/.config/poltergeist/crowd.env      (chmod 600)
PG_CROWD_GEMINI_KEY=...
PG_CROWD_GEMINI_KEY_2=...
```

- Crowd's dev hub (`pnpm dev`) reads that path by default. On World's rehearsal host, start it with `PG_CROWD_ENV_FILE=$HOME/.config/poltergeist/crowd.env`.
- Crowd reads the file itself. The keys are never put into `process.env`, so other lanes' code in the same process can't see them.
- Crowd refuses the file if other users can read it, and logs `chmod 600 …`.
- On a hosted server (Vercel), set `PG_CROWD_GEMINI_KEY` and `PG_CROWD_GEMINI_KEY_2` as encrypted environment variables instead.
- World's shared `GEMINI_API_KEY` is used only if no Crowd key is set.

## What keeps them safe (tested in `test/gemini-keys.test.ts`)

- A key travels only in the `x-goog-api-key` header to Google, never in a URL, a log, phone state, the bus or the browser.
- Log lines and errors are scrubbed (`redact()`), even if Google or the network echoes a key back. Logs say "2 key(s) from private file", never the key.
- Keys sit in private class fields, so printing or serializing the adapter can't show them.
- Tests never read the real file and never call Gemini.

## On Google's side (do this once, in Google AI Studio or Cloud Console)

- Restrict each key to the **Generative Language API**.
- Set a daily quota or budget alert on the project.
- If a key is ever pasted somewhere public, delete it and make a new one.
