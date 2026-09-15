# Temp location RCA and five hardening passes

## Scope and evidence

The reported failures occurred in a desktop ChatGPT viewer and Facebook on iPhone. The inspected desktop viewer remained on “Locating” with its button disabled. The exact native callback failure and the iPhone permission state were not observable. Findings below separate observed behavior from source-level failure paths; they do not claim every viewer supports GPS.

## Root-cause analysis: seven findings

1. **Unbounded location wait — observed symptom, confirmed code defect.** `requestPosition` trusted the native timeout and callbacks. If neither callback arrived, `busy` remained true indefinitely. An independent 15-second JavaScript timer now rejects the request and unlocks recovery. Timers still depend on the browser running JavaScript; suspended apps resume processing when foregrounded.
2. **Location was a single point of failure — confirmed.** No fresh device fix and no saved coordinates meant no weather. A city/ZIP search now offers explicit place selection without geolocation permission. Search is submitted intentionally, and ambiguous results are not silently selected.
3. **Embedded-viewer escape was overstated — confirmed.** The “Open in browser” control was just a same-URL link with `target=_blank`, which cannot guarantee leaving the host app. It now says “Open a new tab”; help explains using the app menu or copying the address to a browser. Facebook's precise native failure remains unverified.
4. **Refresh repeated the dependency on GPS — confirmed.** An explicitly selected city now persists separately, refreshes without GPS, and survives normal reloads. Storage failures preserve the live session. Separate browser/home-screen storage can still require reselecting the city.
5. **Weather failures could look like location failures — confirmed.** The UI stayed at “Locating” during chained weather requests. It now switches to “Updating”, bounds requests, stops retrying permanent HTTP failures, limits the NWS chain, and tries a labeled Open-Meteo model estimate if NWS fails.
6. **Recovery could be overwritten by old asynchronous results — addressed with the new fallback.** Choosing another place invalidates old requests and alert responses. Previous-city weather is cleared while the new choice loads. Invalid coordinates and null forecast temperatures are rejected.
7. **Original verification did not cover the reported mechanism — confirmed.** The original 11 tests always delivered a geolocation callback and never exercised actual manual search. Tests now include silent and late callbacks, missing APIs, thrown exceptions, invalid coordinates, storage failures, manual selection during a pending fix, saved-city refresh, empty search, model fallback, and a full-update watchdog.

## Five completed hardening passes

1. **Location:** independent watchdog, secure-context/policy checks, missing API and synchronous-error handling, coordinate bounds, late-callback suppression.
2. **Permission-independent recovery:** always-accessible city/ZIP search, explicit selection, useful no-results errors, honest browser-opening guidance.
3. **State and persistence:** saved city, GPS-independent refresh, graceful storage failure, request identity checks, no stale city or alert overwrite.
4. **Weather transport:** independent request timers, transient-only retries, NWS cancellation budget, full-update watchdog, labeled model fallback, null-value validation.
5. **Delivery and compatibility:** versioned script/style URLs, retained relative home-screen manifest paths, mobile layout, live service checks, expanded regression tests, and GitHub Pages deployment verification.

## Validation

- 22 automated scenarios passed using controlled browser/service responses.
- Live browser city search for Charlotte, NC returned selectable results.
- Selecting Charlotte produced a real 77°F NWS station observation in the local preview.
- Reload restored the selected city and refreshed without requesting device location.
- The 390 × 844 browser viewport showed the reading, search and buttons without horizontal clipping.
- The Open-Meteo fallback endpoint returned valid Fahrenheit temperature/dew point and mph wind for public test-city coordinates.
- Physical Facebook/iPhone, installed iOS/Android home-screen apps, and OS-level location permission changes were not available for direct testing. Mobile viewport checks do not substitute for those tests.

## How to verify on the affected device

Reload https://stewalexander-com.github.io/temp/. Enter a city or ZIP, tap Find, and select the correct result. A temperature and named place should appear without a location prompt. Close and reopen: the city should reload where browser storage persists. Device location is optional; if the viewer blocks it, use city selection or open the page in Safari/Chrome through the host app menu.

## References

- Geolocation requires permission and can be blocked by browser policy: https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition
- Open-Meteo place search API: https://open-meteo.com/en/docs/geocoding-api
- Open-Meteo weather API and model data: https://open-meteo.com/en/docs

The preserved original-source ZIP remains unchanged; these fixes apply to the GitHub Pages edition.
