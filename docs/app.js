(() => {
  'use strict';

  const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 6 * 1000;
  const LOCATION_TIMEOUT_MS = 15 * 1000;
  const LOCATION_CACHE_MS = 24 * 60 * 60 * 1000;
  const WEATHER_CACHE_MS = 6 * 60 * 60 * 1000;
  const OBSERVATION_STALE_MS = 45 * 60 * 1000;
  const ALERT_TIMEOUT_MS = 5 * 1000;
  const STORAGE = {
    place: 'local-weather:selected-place:v1',
    location: 'local-weather:last-location:v2',
    weather: 'local-weather:last-reading:v2'
  };

  const elements = {
    placeForm: document.getElementById('placeForm'),
    placeQuery: document.getElementById('placeQuery'),
    placeSearch: document.getElementById('placeSearch'),
    placeResults: document.getElementById('placeResults'),
    placeStatus: document.getElementById('placeStatus'),
    useDevice: document.getElementById('useDevice'),
    status: document.getElementById('status'),
    weatherAlert: document.getElementById('weatherAlert'),
    alertTitle: document.getElementById('alertTitle'),
    alertTime: document.getElementById('alertTime'),
    reading: document.getElementById('reading'),
    temperature: document.getElementById('temperature'),
    heatIndex: document.getElementById('heatIndex'),
    dewpoint: document.getElementById('dewpoint'),
    humidity: document.getElementById('humidity'),
    lastUpdated: document.getElementById('lastUpdated'),
    meta: document.getElementById('meta'),
    refresh: document.getElementById('refresh'),
    errorCard: document.getElementById('errorCard'),
    errorTitle: document.getElementById('errorTitle'),
    errorMessage: document.getElementById('errorMessage'),
    errorDetail: document.getElementById('errorDetail'),
    errorRetry: document.getElementById('errorRetry'),
    openBrowser: document.getElementById('openBrowser')
  };

  let selectedPlace = null;
  let requestId = 0;
  let searchId = 0;
  let busy = false;
  let hasReading = false;
  let locationStarted = false;
  let currentWeather = null;
  let currentReadingState = 'live';
  let alertExpiryTimer = null;
  let displayFailed = false;
  let lastAlertLookupAt = 0;

  class WeatherError extends Error {
    constructor(stage, message, cause, kind) {
      super(message);
      this.name = 'WeatherError';
      this.stage = stage;
      this.cause = cause;
      this.kind = kind;
    }
  }

  function geolocationPolicyBlocked() {
    const policy = document.permissionsPolicy || document.featurePolicy;
    try { return Boolean(policy && typeof policy.allowsFeature === 'function' && !policy.allowsFeature('geolocation')); } catch (_) { return false; }
  }

  async function getLocationPermission() {
    if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return null;
    try {
      return await Promise.race([
        navigator.permissions.query({ name: 'geolocation' }),
        new Promise(resolve => window.setTimeout(() => resolve(null), 1200))
      ]);
    } catch (_) {
      return null;
    }
  }

  // HARDENING PASS 1: verify the runtime and make startup failures explicit.
  function verifyRuntime() {
    const missing = Object.entries(elements).filter(([, value]) => !value).map(([key]) => key);
    if (missing.length) throw new WeatherError('startup', `The page is missing required controls: ${missing.join(', ')}.`);
    if (!('fetch' in window)) throw new WeatherError('startup', 'This browser cannot request weather data.');
  }

  function readCache(key, maxAge) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      if (!value || !Number.isFinite(value.savedAt) || Date.now() - value.savedAt > maxAge || value.savedAt > Date.now() + 60000) return null;
      return value;
    } catch (_) {
      return null;
    }
  }

  function writeCache(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify({ ...value, savedAt: Date.now() }));
    } catch (_) {
      // Storage can be unavailable in private browsing; live weather still works.
    }
  }

  // HARDENING PASS 2: request fresh phone location, then safely use a recent last-known position.
  function validCoordinates(value) {
    return value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
      && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
  }

  function requestPosition() {
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext || geolocationPolicyBlocked()) {
        reject(new WeatherError('location', 'This viewer blocks device location.', null, 'policy'));
        return;
      }
      if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
        reject(new WeatherError('location', 'Device location is unavailable. Choose a city or ZIP below.', null, 'unavailable'));
        return;
      }
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        callback(value);
      };
      // Some embedded viewers never invoke either callback, even with a native timeout.
      const timer = window.setTimeout(() => finish(reject,
        new WeatherError('location', 'Location took too long. Choose a city or ZIP below.', null, 'timeout')),
        LOCATION_TIMEOUT_MS);
      try {
        navigator.geolocation.getCurrentPosition(position => {
          if (!validCoordinates(position && position.coords)) {
            finish(reject, new WeatherError('location', 'The device returned an invalid location.', null, 'unavailable'));
          } else finish(resolve, position);
        }, error => finish(reject, new WeatherError('location',
          error.code === 1 ? 'Location permission was denied.' : 'The device could not determine its location. Choose a city or ZIP below.',
          error, error.code === 1 ? 'denied' : 'unavailable')),
          { enableHighAccuracy: false, timeout: LOCATION_TIMEOUT_MS, maximumAge: 5 * 60 * 1000 });
      } catch (error) {
        finish(reject, new WeatherError('location', 'This viewer could not request location. Choose a city or ZIP below.', error, 'unavailable'));
      }
    });
  }

  async function getCoordinates() {
    try {
      const position = await requestPosition();
      const result = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        cached: false
      };
      writeCache(STORAGE.location, result);
      return result;
    } catch (error) {
      const cached = readCache(STORAGE.location, LOCATION_CACHE_MS);
      if (validCoordinates(cached)) {
        return { ...cached, cached: true, locationError: error };
      }
      // GitHub Pages has no server-side IP geolocation endpoint.
      throw error;
    }
  }

  // HARDENING PASS 3: bound every NWS request and retry temporary failures once.
  async function fetchJson(url, stage, parentSignal) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (parentSignal && parentSignal.aborted) throw new WeatherError(stage, 'Weather request timed out.');
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (parentSignal) parentSignal.addEventListener('abort', abort, { once: true });
      let timeout;
      const timedOut = new Promise((_, reject) => {
        timeout = window.setTimeout(() => { controller.abort(); reject(new Error('Request timed out')); }, FETCH_TIMEOUT_MS);
      });
      try {
        return await Promise.race([timedOut, (async () => {
        const response = await fetch(url, {
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/geo+json, application/json' }
        });
        if (!response.ok) { const error = new Error(`HTTP ${response.status}`); error.status = response.status; throw error; }
        return await response.json();
        })()]);
      } catch (error) {
        lastError = error;
        if (parentSignal && parentSignal.aborted) break;
        if (error.status >= 400 && error.status < 500 && error.status !== 429) break;
        if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 450));
      } finally {
        window.clearTimeout(timeout);
        if (parentSignal) parentSignal.removeEventListener('abort', abort);
      }
    }
    throw new WeatherError(stage, 'The weather service did not respond. Check your connection and retry.', lastError);
  }

  function toFahrenheit(quantity) {
    if (!quantity || !Number.isFinite(quantity.value)) return null;
    const unit = String(quantity.unitCode || '').toLowerCase();
    if (unit.includes('degc')) return (quantity.value * 9 / 5) + 32;
    if (unit.includes('degf')) return quantity.value;
    return null;
  }

  function toMilesPerHour(quantity) {
    if (!quantity || !Number.isFinite(quantity.value)) return null;
    const unit = String(quantity.unitCode || '').toLowerCase();
    if (unit.includes('m_s-1') || unit.includes('m/s')) return quantity.value * 2.236936;
    if (unit.includes('km_h-1') || unit.includes('km/h')) return quantity.value * 0.621371;
    if (unit.includes('kn')) return quantity.value * 1.150779;
    if (unit.includes('mi_h-1') || unit.includes('mph')) return quantity.value;
    return null;
  }

  function validReading(reading) {
    return reading && Number.isFinite(reading.temperature) && Number.isFinite(reading.dewpoint);
  }

  // Convert the NWS-provided dew point into the relative humidity required by
  // the NWS heat-index equation. Temperatures are converted to Celsius first.
  function relativeHumidityFromDewpoint(temperatureF, dewpointF) {
    const temperatureC = (temperatureF - 32) * 5 / 9;
    const dewpointC = (dewpointF - 32) * 5 / 9;
    const saturationAtDewpoint = Math.exp((17.625 * dewpointC) / (243.04 + dewpointC));
    const saturationAtTemperature = Math.exp((17.625 * temperatureC) / (243.04 + temperatureC));
    return Math.min(100, Math.max(0, 100 * saturationAtDewpoint / saturationAtTemperature));
  }

  function calculateHeatIndex(temperatureF, dewpointF) {
    const relativeHumidity = relativeHumidityFromDewpoint(temperatureF, dewpointF);
    const simple = 0.5 * (
      temperatureF + 61 + ((temperatureF - 68) * 1.2) + (relativeHumidity * 0.094)
    );
    const initial = (simple + temperatureF) / 2;

    // The NWS applies the full Rothfusz regression only when the initial value
    // reaches 80°F. Below that threshold, heat index is not operationally shown.
    if (initial < 80) return temperatureF;

    const t = temperatureF;
    const rh = relativeHumidity;
    let heatIndex = -42.379
      + (2.04901523 * t)
      + (10.14333127 * rh)
      - (0.22475541 * t * rh)
      - (0.00683783 * t * t)
      - (0.05481717 * rh * rh)
      + (0.00122874 * t * t * rh)
      + (0.00085282 * t * rh * rh)
      - (0.00000199 * t * t * rh * rh);

    if (rh < 13 && t >= 80 && t <= 112) {
      heatIndex -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(t - 95)) / 17);
    } else if (rh > 85 && t >= 80 && t <= 87) {
      heatIndex += ((rh - 85) / 10) * ((87 - t) / 5);
    }

    return heatIndex;
  }

  function calculateWindChill(temperatureF, windSpeedMph) {
    if (!Number.isFinite(windSpeedMph) || temperatureF > 50 || windSpeedMph <= 3) return temperatureF;
    const windFactor = Math.pow(windSpeedMph, 0.16);
    return 35.74 + (0.6215 * temperatureF) - (35.75 * windFactor) + (0.4275 * temperatureF * windFactor);
  }

  async function readStationObservation(stationsUrl, signal) {
    const stations = await fetchJson(stationsUrl, 'stations', signal);
    const candidates = (stations.features || []).slice(0, 2);
    for (const station of candidates) {
      const stationUrl = station && (station.id || (station.properties && station.properties['@id']));
      if (!stationUrl) continue;
      try {
        const observation = await fetchJson(`${stationUrl.replace(/\/$/, '')}/observations/latest`, 'observation', signal);
        const properties = observation && observation.properties;
        const reading = {
          temperature: toFahrenheit(properties && properties.temperature),
          dewpoint: toFahrenheit(properties && properties.dewpoint),
          windSpeed: toMilesPerHour(properties && properties.windSpeed),
          windChill: toFahrenheit(properties && properties.windChill),
          sourceTime: properties && properties.timestamp,
          sourceKind: 'observation',
          source: (properties && properties.stationName) || 'NWS station observation'
        };
        if (validReading(reading)) return reading;
      } catch (_) {
        // A nearby station can be temporarily incomplete; continue to the next one.
      }
    }
    throw new WeatherError('observation', 'Nearby NWS stations did not provide both temperature and dew point.');
  }

  async function readHourlyForecast(forecastUrl, signal) {
    const joiner = forecastUrl.includes('?') ? '&' : '?';
    const forecast = await fetchJson(`${forecastUrl}${joiner}units=us`, 'forecast', signal);
    const period = forecast && forecast.properties && forecast.properties.periods && forecast.properties.periods[0];
    const reading = {
      temperature: period && period.temperature,
      dewpoint: toFahrenheit(period && period.dewpoint),
      sourceTime: period && period.startTime,
      sourceKind: 'forecast',
      source: 'NWS hourly forecast'
    };
    if (!validReading(reading)) throw new WeatherError('forecast', 'The NWS hourly forecast was incomplete.');
    return reading;
  }

  // HARDENING PASS 4: try several observations, then an independent hourly forecast path.
  async function loadNwsWeather(coordinates, signal) {
    const latitude = coordinates.latitude.toFixed(4);
    const longitude = coordinates.longitude.toFixed(4);
    const point = await fetchJson(`https://api.weather.gov/points/${latitude},${longitude}`, 'location lookup', signal);
    const properties = point && point.properties;
    if (!properties) throw new WeatherError('location lookup', 'The NWS did not recognize this location.');

    const relative = properties.relativeLocation && properties.relativeLocation.properties;
    const location = relative && relative.city && relative.state
      ? `${relative.city}, ${relative.state}`
      : `${latitude}, ${longitude}`;

    let reading;
    try {
      if (!properties.observationStations) throw new Error('No station endpoint.');
      reading = await readStationObservation(properties.observationStations, signal);
    } catch (_) {
      if (!properties.forecastHourly) throw new WeatherError('forecast', 'No NWS observation or hourly forecast is available here.');
      reading = await readHourlyForecast(properties.forecastHourly, signal);
    }

    return {
      ...reading,
      location: coordinates.label || location,
      usedCachedLocation: coordinates.cached,
      usedApproximateLocation: coordinates.approximate,
      fetchedAt: Date.now()
    };
  }

  function formatSuccessfulUpdate(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return 'time unavailable';
    const today = new Date();
    const sameDay = date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
    const formatted = new Intl.DateTimeFormat(undefined, sameDay
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    ).format(date);
    return formatted;
  }

  function validTimestamp(timestamp) {
    const value = new Date(timestamp).getTime();
    return Number.isFinite(value) ? value : null;
  }

  function formatAge(timestamp) {
    const value = validTimestamp(timestamp);
    if (value === null) return 'time unavailable';
    const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes === 1) return '1 min ago';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? '1 hr ago' : `${hours} hr ago`;
  }

  function renderFreshness(weather, state) {
    const sourceTimestamp = validTimestamp(weather.sourceTime) ?? validTimestamp(weather.fetchedAt);
    const sourceKind = weather.sourceKind === 'forecast' || weather.sourceKind === 'model' ? 'forecast' : 'observation';
    const stale = state === 'cached' || (sourceTimestamp !== null && Date.now() - sourceTimestamp > OBSERVATION_STALE_MS);

    if (sourceKind === 'forecast') {
      elements.status.className = `status ${stale ? 'stale' : ''}`.trim();
      elements.status.textContent = weather.sourceKind === 'model' ? 'Estimate' : 'Forecast';
      elements.lastUpdated.textContent = `Forecast for ${formatSuccessfulUpdate(sourceTimestamp ?? weather.fetchedAt)} · received ${formatSuccessfulUpdate(weather.fetchedAt)}`;
    } else {
      elements.status.className = `status ${stale ? 'stale' : ''}`.trim();
      elements.status.textContent = stale ? 'Last reading' : 'Observed';
      elements.lastUpdated.textContent = `Observed ${formatAge(sourceTimestamp ?? weather.fetchedAt)} · received ${formatSuccessfulUpdate(weather.fetchedAt)}`;
    }
    elements.lastUpdated.dateTime = new Date(sourceTimestamp ?? weather.fetchedAt).toISOString();
  }

  function hideError() {
    elements.errorCard.hidden = true;
    elements.openBrowser.hidden = true;
    document.body.classList.remove('fatal', 'degraded');
  }

  function renderReading(weather, state) {
    const temperature = Math.round(weather.temperature);
    const dewpoint = Math.round(weather.dewpoint);
    const humidity = Math.round(relativeHumidityFromDewpoint(weather.temperature, weather.dewpoint));
    const heatIndex = Math.round(calculateHeatIndex(weather.temperature, weather.dewpoint));
    const calculatedWindChill = Number.isFinite(weather.windChill)
      ? weather.windChill
      : calculateWindChill(weather.temperature, weather.windSpeed);
    const windChill = Math.round(calculatedWindChill);
    if (!Number.isFinite(temperature) || !Number.isFinite(dewpoint) || !Number.isFinite(humidity) || !Number.isFinite(heatIndex)) {
      throw new WeatherError('display', 'The weather values could not be displayed.');
    }

    const temperatureCharacters = String(temperature).length;
    const thermalBand = temperature <= 32
      ? 'freezing'
      : (temperature < 60 ? 'cool' : (temperature < 85 ? 'mild' : 'hot'));
    elements.reading.classList.remove('thermal-neutral', 'thermal-freezing', 'thermal-cool', 'thermal-mild', 'thermal-hot');
    elements.reading.classList.add(`thermal-${thermalBand}`);
    elements.temperature.setAttribute('data-width', temperatureCharacters >= 4 ? 'extreme' : (temperatureCharacters >= 3 ? 'wide' : 'standard'));
    elements.temperature.innerHTML = `${temperature}<span class="unit">°F</span>`;
    elements.temperature.setAttribute('aria-label', `${temperature} degrees Fahrenheit`);
    if (heatIndex !== temperature) {
      elements.heatIndex.className = 'heat-index';
      elements.heatIndex.textContent = `Heat index ${heatIndex}°F`;
      elements.heatIndex.hidden = false;
    } else if (Number.isFinite(windChill) && temperature - windChill >= 2) {
      elements.heatIndex.className = 'heat-index cold';
      elements.heatIndex.textContent = `Wind chill ${windChill}°F`;
      elements.heatIndex.hidden = false;
    } else {
      elements.heatIndex.className = 'heat-index';
      elements.heatIndex.textContent = '';
      elements.heatIndex.hidden = true;
    }
    elements.dewpoint.textContent = `${dewpoint}°F`;
    elements.humidity.textContent = `${humidity}%`;
    elements.reading.setAttribute('aria-busy', 'false');
    hasReading = true;
    displayFailed = false;
    currentWeather = weather;
    currentReadingState = state;
    elements.refresh.textContent = weather.usedApproximateLocation ? 'Try precise location' : 'Refresh now';

    renderFreshness(weather, state);
    const locationNote = weather.usedApproximateLocation
      ? `approximate area near ${weather.location}`
      : (weather.usedCachedLocation ? `saved device location near ${weather.location}` : weather.location);
    elements.meta.textContent = `${locationNote} · ${weather.source}`;
  }

  function hideExpiredAlert() {
    elements.weatherAlert.hidden = true;
    elements.alertTitle.textContent = '';
    elements.alertTime.textContent = '';
    if (alertExpiryTimer !== null) window.clearTimeout(alertExpiryTimer);
    alertExpiryTimer = null;
  }

  async function updateAlerts(coordinates, id) {
    if (Date.now() - lastAlertLookupAt < 30 * 1000) return;
    lastAlertLookupAt = Date.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), ALERT_TIMEOUT_MS);
    try {
      const latitude = coordinates.latitude.toFixed(4);
      const longitude = coordinates.longitude.toFixed(4);
      const response = await fetch(`https://api.weather.gov/alerts/active?point=${latitude},${longitude}`, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/geo+json, application/json' }
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (id !== requestId) return;
      const now = Date.now();
      const severityRank = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
      const warnings = (payload.features || []).filter(feature => {
        const properties = feature && feature.properties;
        const expires = validTimestamp(properties && (properties.expires || properties.ends));
        return properties
          && properties.status === 'Actual'
          && properties.messageType !== 'Cancel'
          && /warning$/i.test(properties.event || '')
          && (expires === null || expires > now);
      }).sort((left, right) => {
        const leftRank = severityRank[left.properties.severity] ?? 0;
        const rightRank = severityRank[right.properties.severity] ?? 0;
        return rightRank - leftRank;
      });

      if (!warnings.length) {
        hideExpiredAlert();
        return;
      }

      const primary = warnings[0];
      const properties = primary.properties;
      const expires = validTimestamp(properties.expires || properties.ends);
      elements.alertTitle.textContent = `${properties.event}${warnings.length > 1 ? ` +${warnings.length - 1}` : ''}`;
      elements.alertTime.textContent = expires === null ? 'Active now' : `Until ${formatSuccessfulUpdate(expires)}`;
      elements.weatherAlert.href = `https://forecast.weather.gov/MapClick.php?lat=${latitude}&lon=${longitude}`;
      elements.weatherAlert.setAttribute('aria-label', `${elements.alertTitle.textContent}. ${elements.alertTime.textContent}. Open National Weather Service details.`);
      elements.weatherAlert.hidden = false;

      if (alertExpiryTimer !== null) window.clearTimeout(alertExpiryTimer);
      if (expires !== null) {
        alertExpiryTimer = window.setTimeout(hideExpiredAlert, Math.min(expires - now, 2147483647));
      }
    } catch (_) {
      // Alert lookup is supplemental. It never blocks or downgrades the weather reading.
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function renderLoading() {
    hideError();
    elements.reading.setAttribute('aria-busy', 'true');
    elements.status.className = 'status loading';
    elements.status.textContent = selectedPlace || hasReading ? 'Updating' : 'Locating';
    elements.meta.textContent = selectedPlace ? `Loading weather for ${selectedPlace.label}…` : (hasReading ? 'Refreshing weather…' : 'Requesting device location…');
    elements.refresh.disabled = true;
    elements.errorRetry.disabled = true;
  }

  function renderReady() {
    hideError();
    elements.reading.setAttribute('aria-busy', 'false');
    elements.status.className = hasReading ? 'status stale' : 'status';
    elements.status.textContent = hasReading ? 'Last reading' : 'Ready';
    elements.meta.textContent = hasReading
      ? 'Showing the last reading. Tap Use my location to update it.'
      : 'Use device location or choose a city / ZIP.';
    elements.refresh.textContent = 'Use my location';
    elements.refresh.disabled = false;
    elements.errorRetry.disabled = false;
  }

  function describeError(error) {
    const stage = error && error.stage ? error.stage : 'unknown stage';
    const policyBlocked = error && error.stage === 'location' && error.kind === 'policy';
    const permissionDenied = error && error.stage === 'location' && error.kind === 'denied';
    if (policyBlocked) {
      return {
        title: 'Choose a place',
        message: 'This viewer blocks device location. Choose a city or ZIP below to get weather here.',
        detail: 'For device location in Facebook, use its menu to open in Safari. On desktop, copy this page address into your browser. A new tab may stay inside the same app.',
        showOpenBrowser: true
      };
    }
    if (permissionDenied) {
      return {
        title: 'Location blocked',
        message: 'Choose a city or ZIP below, or allow this site to use location in your browser and device settings.',
        detail: 'In Facebook, use its menu to open in Safari for device location. City search works without location permission.',
        showOpenBrowser: false
      };
    }
    return {
      title: 'Weather unavailable',
      message: (error && error.message) || 'The location or weather request failed.',
      detail: `Stage: ${stage}. Choose a place below or retry when your connection is available.`
    };
  }

  // HARDENING PASS 5: restore the last good reading instantly and surface exact failure stage.
  function renderError(error) {
    const description = describeError(error);
    elements.errorTitle.textContent = description.title;
    elements.errorMessage.textContent = description.message;
    elements.errorDetail.textContent = description.detail;
    elements.openBrowser.href = window.location.href;
    elements.openBrowser.hidden = !description.showOpenBrowser;
    elements.errorCard.hidden = false;
    elements.status.className = 'status error';
    elements.status.textContent = 'Failed';
    displayFailed = true;
    elements.reading.setAttribute('aria-busy', 'false');
    document.body.classList.add(hasReading ? 'degraded' : 'fatal');
    elements.meta.textContent = hasReading ? 'Showing the last successful reading.' : 'No usable weather reading is available.';
  }

  async function loadWeather(coordinates) {
    const controller = new AbortController();
    const deadline = window.setTimeout(() => controller.abort(), 18000);
    try { return await loadNwsWeather(coordinates, controller.signal); }
    catch (_) {
      const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${coordinates.latitude.toFixed(4)}&longitude=${coordinates.longitude.toFixed(4)}&current=temperature_2m,dew_point_2m,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime`, 'weather fallback');
      const current = data.current;
      const weather = {
        temperature: current && current.temperature_2m,
        dewpoint: current && current.dew_point_2m,
        windSpeed: current && current.wind_speed_10m,
        sourceTime: current && Number.isFinite(current.time) ? new Date(current.time * 1000).toISOString() : null,
        sourceKind: 'model', source: 'Open-Meteo model estimate',
        location: coordinates.label || `${coordinates.latitude.toFixed(2)}, ${coordinates.longitude.toFixed(2)}`,
        usedCachedLocation: coordinates.cached, fetchedAt: Date.now()
      };
      if (!validReading(weather) || !weather.sourceTime) throw new WeatherError('weather fallback', 'No usable weather is available for this place.');
      return weather;
    } finally { window.clearTimeout(deadline); }
  }

  async function updateWeather() {
    if (busy) return;
    const id = ++requestId;
    locationStarted = true;
    busy = true;
    renderLoading();
    const watchdog = window.setTimeout(() => {
      if (id !== requestId) return;
      ++requestId; busy = false;
      renderError(new WeatherError('weather', 'Weather took too long. Retry or choose another place.'));
      elements.refresh.disabled = false; elements.errorRetry.disabled = false;
    }, 55000);
    try {
      const coordinates = selectedPlace || await getCoordinates();
      if (id !== requestId) return;
      elements.status.textContent = 'Updating';
      elements.meta.textContent = 'Loading weather…';
      const weather = await loadWeather(coordinates);
      if (id !== requestId) return;
      renderReading(weather, 'live');
      writeCache(STORAGE.weather, weather);
      void updateAlerts(coordinates, id);
      hideError();
    } catch (error) {
      if (id !== requestId) return;
      if (error && error.stage === 'location') locationStarted = false;
      renderError(error);
    } finally {
      window.clearTimeout(watchdog);
      if (id === requestId) {
        busy = false;
        elements.refresh.disabled = false;
        elements.errorRetry.disabled = false;
      }
    }
  }

  function changePlace(place) {
    ++requestId; // Late device and weather responses must not overwrite a new choice.
    busy = false;
    selectedPlace = place;
    writeCache(STORAGE.place, place || {});
    hideExpiredAlert();
    lastAlertLookupAt = 0;
    // Do not show a previous city's reading while the selected place is loading.
    hasReading = false;
    currentWeather = null;
    elements.temperature.innerHTML = '--<span class="unit">°F</span>';
    elements.temperature.setAttribute('aria-label', 'Temperature loading');
    elements.dewpoint.textContent = '--°F';
    elements.humidity.textContent = '--%';
    elements.heatIndex.hidden = true;
    elements.lastUpdated.textContent = 'Waiting for weather…';
    writeCache(STORAGE.weather, {});
    void updateWeather();
  }

  async function searchPlaces(event) {
    event.preventDefault();
    const query = elements.placeQuery.value.trim();
    const id = ++searchId;
    elements.placeResults.replaceChildren();
    if (query.length < 2) { elements.placeStatus.textContent = 'Enter at least two characters or a ZIP code.'; return; }
    elements.placeSearch.disabled = true;
    elements.placeStatus.textContent = 'Finding places…';
    try {
      const data = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`, 'city search');
      if (id !== searchId) return;
      const places = (data.results || []).filter(validCoordinates);
      elements.placeStatus.textContent = places.length ? 'Choose your place:' : 'No matches. Try a nearby city, or add the state or country.';
      places.forEach(place => {
        const label = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.addEventListener('click', () => {
          elements.placeResults.replaceChildren();
          elements.placeStatus.textContent = `Selected: ${label}`;
          changePlace({ latitude: place.latitude, longitude: place.longitude, label });
        });
        elements.placeResults.appendChild(button);
      });
    } catch (_) {
      if (id === searchId) elements.placeStatus.textContent = 'City search is unavailable. Check your connection and try again.';
    } finally { if (id === searchId) elements.placeSearch.disabled = false; }
  }

  async function start() {
    try {
      verifyRuntime();
      const savedPlace = readCache(STORAGE.place, 365 * 24 * 60 * 60 * 1000);
      if (validCoordinates(savedPlace) && typeof savedPlace.label === 'string') {
        selectedPlace = savedPlace;
        elements.placeStatus.textContent = `Selected: ${savedPlace.label}`;
      }
      elements.placeForm.addEventListener('submit', searchPlaces);
      elements.useDevice.addEventListener('click', () => changePlace(null));
      const cachedWeather = readCache(STORAGE.weather, WEATHER_CACHE_MS);
      if (validReading(cachedWeather)) renderReading(cachedWeather, 'cached');

      const cachedLocation = readCache(STORAGE.location, LOCATION_CACHE_MS);

      elements.refresh.addEventListener('click', updateWeather);
      elements.errorRetry.addEventListener('click', updateWeather);
      window.addEventListener('online', () => {
        if (locationStarted) updateWeather();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && locationStarted) updateWeather();
      });

      const permission = await getLocationPermission();
      if (permission) {
        const handlePermissionChange = () => {
          if (permission.state === 'granted' && !locationStarted && !selectedPlace) {
            locationStarted = true;
            updateWeather();
          } else if (permission.state === 'denied' && !hasReading && !selectedPlace) {
            locationStarted = false;
            renderError(new WeatherError('location', 'Location permission was denied.', { code: 1 }, 'denied'));
          }
        };
        if (typeof permission.addEventListener === 'function') {
          permission.addEventListener('change', handlePermissionChange);
        } else if ('onchange' in permission) {
          permission.onchange = handlePermissionChange;
        }
      }

      if (selectedPlace || cachedLocation || (permission && permission.state === 'granted')) {
        locationStarted = true;
        updateWeather();
      } else if (permission && permission.state === 'denied') {
        locationStarted = true;
        updateWeather();
      } else {
        renderReady();
      }
      window.setInterval(() => {
        if (locationStarted && document.visibilityState === 'visible') updateWeather();
      }, REFRESH_INTERVAL_MS);
      window.setInterval(() => {
        if (currentWeather && !busy && !displayFailed) renderFreshness(currentWeather, currentReadingState);
      }, 60 * 1000);
    } catch (error) {
      if (elements.errorCard) renderError(error);
    }
  }

  void start();
})();
