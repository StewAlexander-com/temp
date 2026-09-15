# Export notes

- Source: Temp° version 27, September 15, 2026.
- Exact source commit: `7cc81a73a027eded40fa84d342bf603c703f7c5c`.
- Original archive contains every tracked file at that commit, byte-for-byte.
- Git history, credentials, dependencies, generated builds, local runtime state,
  and remote storage contents are excluded.
- Pages HTML was derived from the original page markup. CSS and icon bytes are
  unchanged. Framework script loading was replaced with a deferred local script.
- Manifest start URL, scope, ID, and icon paths are relative for subfolder hosting.
- Removed only the client calls to the two unavailable server endpoints; updated
  location-denial guidance to explain the static edition's behavior.
- Original server source is preserved separately without modification.

## Verification

- JavaScript syntax check passed.
- All 11 location/weather regression scenarios passed using mocked browser and
  NWS responses, including permission denial, cached location, stale readings,
  wind chill, and warning display.
- Required DOM controls, unique IDs, local assets, and manifest paths verified.
- Static HTTP serving of the page and assets under a subdirectory passed.
- All 42 archived original-source files matched the saved commit byte-for-byte.
- CSS and installation icon files match the original source exactly.
- Live NWS access and physical iPhone/Android installation were not exercised in
  this export session; the new GitHub deployment has not been published.
