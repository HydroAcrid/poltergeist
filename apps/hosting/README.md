# Hosted rehearsal

The Vercel production site sends visitors to the current World sandbox. Guests open `/haunt`, the projector opens `/stage`, and the operator signs in at `/debug`. All visitors share one Fastify process and round. The production project holds `GEMINI_API_KEY` and `PG_HOST_TOKEN` as sensitive server variables.

The named persistent sandbox `poltergeist-world` has the checked-out game and installed lane packages in `/vercel/sandbox/app`, and the prepared, character-free venue image at `/vercel/sandbox/plate.jpg`. It exposes port 3000. Use the production entry links when returning after a sandbox suspension. The entry function resumes the saved filesystem and restarts the server if needed. In-memory rounds and pending proposals last for one sandbox session. Start a new round after a restart.
