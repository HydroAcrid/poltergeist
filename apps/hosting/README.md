# Hosted rehearsal

The Vercel production site sends visitors to the current World sandbox. Guests open `/haunt`, the projector opens `/stage`, and the operator signs in at `/debug`. All visitors share one Fastify process and round. The production project holds `GEMINI_API_KEY` and `PG_HOST_TOKEN` as sensitive server variables.

The gateway uses the persistent sandbox named by `PG_WORLD_SANDBOX_NAME`, defaulting to `poltergeist-world`. Deploying a candidate gateway with a separate sandbox lets an existing room finish on its original host. The sandbox has the checked-out game and installed lane packages in `/vercel/sandbox/app`, and the prepared, character-free venue image at `/vercel/sandbox/plate.jpg`. It exposes port 3000. Use the production entry links when returning after a sandbox suspension. The entry function resumes the saved filesystem and restarts the server if needed. In-memory rounds and pending proposals last for one sandbox session. Start a new round after a restart.

The entry function redirects the browser to the sandbox, which streams the game directly. On cold start the gateway reads the Vercel session deadline and extends a short lease in place when the plan allows. World checks that deadline before opening a paid game. The five-minute demo counts wall time. The ten-minute game reserves ten minutes of play and time for the provider connections between chapters. If the current lease is too short, the host sees when to reopen the stable link for a fresh session. Existing rooms continue through their current lease. [Vercel Sandbox duration and persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence)

## Updating the running game

Merge the Brain and Crowd branches into the World candidate and run all three suites. Create a Git archive of the exact reviewed commit. Install the archive and its locked dependencies in a separate persistent sandbox at `/vercel/sandbox/app`. Write the full Git SHA followed by a newline to `/vercel/sandbox/app/.release-commit` and start the host with `node apps/world/rehearsal/run.mjs --genie` using its existing server-side environment. Verify the candidate's phone, projector and host sign-in. A live round on the previous sandbox can finish there.

Select the candidate with the production `PG_WORLD_SANDBOX_NAME` variable and deploy the gateway from `apps/hosting`. Follow the public redirect on `/rehearsal/lobby` and compare `runtimeCommit` to the reviewed SHA. Check `/haunt` and `/stage` from the public domain before telling the team the release is live.
