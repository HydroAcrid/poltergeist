// The entry function reads the live Vercel session. An unhosted World has no VM lease.
export function sessionDeadline(session) {
  const startedAt = Number(session.createdAt);
  if (!Number.isFinite(startedAt) || !(session.timeout > 0)) throw Error('World session deadline unavailable');
  return startedAt + session.timeout;
}

export const providerWaitMs = 35_000;

export function worldLeaseWarning({
  mode, durationMs, requestedAt, now = Date.now(), openingMs = 0, cutMs,
  deadline = process.env.PG_WORLD_LEASE_END_MS,
}) {
  if (!deadline || mode === 'offline-rehearsal') return null;
  const leaseEndsAt = Number(deadline);
  if (!Number.isFinite(leaseEndsAt))
    return {error:'The host could not check its available time. Reopen the host link and try again.'};
  const requiredMs = requiredWorldTime({mode,durationMs,requestedAt,now,openingMs,cutMs});
  if (leaseEndsAt - now >= requiredMs) return null;
  const minutes = Math.max(0, Math.floor((leaseEndsAt - now) / 60_000));
  const fitsShortShow = mode === 'ten-minute-game' && leaseEndsAt - now >= 300_000;
  return {
    leaseEndsAt, requiredMs,
    error: 'This host has ' + (minutes === 0 ? 'less than a minute' : minutes + (minutes === 1 ? ' minute' : ' minutes'))
        + ' left before it renews. ' + (fitsShortShow ? 'The five-minute demo still fits. ' : '')
        + 'For the full game, reopen the host link after ' + new Date(leaseEndsAt).toISOString().slice(11,16) + ' UTC.',
  };
}

function requiredWorldTime({mode,durationMs,requestedAt,now,openingMs,cutMs}) {
  if (mode === 'five-minute-demo') {
    return Math.max(0, requestedAt + durationMs - now);
  } else {
    // The active game clock pauses while one provider closes and the next one opens.
    const handoffs = mode === 'ten-minute-game' ? Math.max(0, Math.ceil(durationMs / cutMs) - 1) : 0;
    return openingMs + durationMs + (1 + 2 * handoffs) * providerWaitMs;
  }
}

// A shorter configured session can be extended in place. A plan ceiling leaves the
// real deadline intact, so a five-minute show or a camera test can still fit.
export async function prepareColdHostLease(session, now = Date.now()) {
  const requiredMs = requiredWorldTime({
    mode:'ten-minute-game', durationMs:600_000, cutMs:55_000, openingMs:30_000, now, requestedAt:now,
  });
  const missing = requiredMs - (sessionDeadline(session) - now);
  if (missing > 0) {
    try { await session.extendTimeout(missing); }
    catch { /* The verified SDK deadline remains authoritative on a refused extension. */ }
  }
  return sessionDeadline(session);
}
