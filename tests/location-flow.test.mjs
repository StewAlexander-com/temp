import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');

class Element {
  constructor(id) {
    this.id = id;
    this.hidden = id === 'heatIndex' || id === 'weatherAlert' || id === 'errorCard' || id === 'openBrowser';
    this.textContent = '';
    this.className = '';
    this.classList = {
      add: (...names) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach(name => classes.add(name));
        this.className = [...classes].join(' ');
      },
      remove: (...names) => {
        const removed = new Set(names);
        this.className = this.className.split(/\s+/).filter(name => name && !removed.has(name)).join(' ');
      }
    };
    this.disabled = false;
    this.attributes = new Map();
    this.listeners = new Map();
  }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  async click() { await this.listeners.get('click')?.(); }
}

const ids = ['status', 'weatherAlert', 'alertTitle', 'alertTime', 'reading', 'temperature', 'heatIndex', 'dewpoint', 'humidity', 'lastUpdated', 'meta', 'refresh', 'errorCard', 'errorTitle', 'errorMessage', 'errorDetail', 'errorRetry', 'openBrowser'];

function weatherResponse(url, options) {
  const { approximateAvailable, stationProperties, alerts } = options;
  if (url.includes('/points/')) return { properties: { observationStations: 'https://stations.test', relativeLocation: { properties: { city: 'Testville', state: 'TS' } } } };
  if (url === 'https://stations.test') return { features: [{ id: 'https://station.test/TEST' }] };
  if (url.includes('/observations/latest')) return { properties: stationProperties || { temperature: { value: 30, unitCode: 'wmoUnit:degC' }, dewpoint: { value: 20, unitCode: 'wmoUnit:degC' }, timestamp: new Date().toISOString(), stationName: 'Test station' } };
  if (url.includes('/alerts/active?point=')) return { features: alerts || [] };
  return {};
}

async function settle() {
  for (let index = 0; index < 12; index += 1) await new Promise(resolve => setImmediate(resolve));
}

async function boot({ permission = 'prompt', geolocation = 'success', cachedLocation = false, policyAllows = true, approximateAvailable = false, stationProperties = null, alerts = [] } = {}) {
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const storage = new Map();
  if (cachedLocation) storage.set('local-weather:last-location:v2', JSON.stringify({ latitude: 35, longitude: -80, accuracy: 20, savedAt: Date.now() }));
  let geoCalls = 0;
  const permissionListeners = [];
  const windowListeners = new Map();
  const unrefTimeout = (handler, delay) => {
    const timer = setTimeout(handler, delay);
    if (delay > 60 * 1000) timer.unref?.();
    return timer;
  };
  const permissionStatus = {
    state: permission,
    addEventListener(name, handler) { if (name === 'change') permissionListeners.push(handler); }
  };
  const context = {
    console,
    Date,
    Intl,
    Math,
    JSON,
    Promise,
    AbortController,
    setImmediate,
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      setItem(key, value) { storage.set(key, value); }
    },
    navigator: {
      permissions: { query() { return permission === 'hang' ? new Promise(() => {}) : Promise.resolve(permissionStatus); } },
      geolocation: {
        getCurrentPosition(success, failure) {
          geoCalls += 1;
          if (geolocation === 'success') success({ coords: { latitude: 35, longitude: -80, accuracy: 20 } });
          else failure({ code: 1 });
        }
      }
    },
    document: {
      visibilityState: 'visible',
      permissionsPolicy: { allowsFeature() { return policyAllows; } },
      getElementById(id) { return elements[id]; },
      addEventListener(name, handler) { windowListeners.set(`document:${name}`, handler); },
      body: { classList: { add() {}, remove() {} } }
    },
    fetch: async url => {
      const value = weatherResponse(String(url), { approximateAvailable, stationProperties, alerts });
      assert.ok(!String(url).startsWith('/'), 'static edition must not call a root-relative server endpoint');
      return { ok: true, status: 200, async json() { return value; } };
    },
    window: {
      isSecureContext: true,
      location: { href: 'https://example.test/' },
      setTimeout: unrefTimeout,
      clearTimeout,
      setInterval() {},
      addEventListener(name, handler) { windowListeners.set(name, handler); }
    }
  };
  context.window.fetch = context.fetch;
  vm.runInNewContext(source, context);
  await settle();
  return { elements, get geoCalls() { return geoCalls; }, permissionStatus, permissionListeners, windowListeners };
}

{
  const app = await boot({ permission: 'prompt' });
  assert.equal(app.geoCalls, 0, 'first visit must not trigger location before a user gesture');
  assert.equal(app.elements.status.textContent, 'Ready');
  assert.equal(app.elements.refresh.textContent, 'Use my location');
}

{
  const app = await boot({ permission: 'hang' });
  await new Promise(resolve => setTimeout(resolve, 1300));
  await settle();
  assert.equal(app.elements.status.textContent, 'Ready', 'a stalled Permissions API must not block the site');
}

{
  const app = await boot({ permission: 'granted' });
  assert.equal(app.geoCalls, 1, 'previously granted location should load automatically');
  assert.equal(app.elements.status.textContent, 'Observed');
  assert.match(app.elements.temperature.innerHTML, /86/);
  assert.equal(app.elements.humidity.textContent, '55%');
  assert.match(app.elements.lastUpdated.textContent, /^Observed /);
  assert.equal(app.elements.weatherAlert.hidden, true);
}

{
  const app = await boot({ permission: 'prompt' });
  await app.elements.refresh.click();
  await settle();
  assert.equal(app.geoCalls, 1, 'the location button should start a weather request');
  assert.equal(app.elements.status.textContent, 'Observed');
}

{
  const app = await boot({ permission: 'prompt', geolocation: 'denied' });
  await app.elements.refresh.click();
  await settle();
  assert.equal(app.elements.errorTitle.textContent, 'Location blocked');
  await app.windowListeners.get('document:visibilitychange')?.();
  await settle();
  assert.equal(app.geoCalls, 1, 'denial must not create a visibility-change prompt loop');
}

{
  const app = await boot({ permission: 'denied', geolocation: 'denied', approximateAvailable: true });
  await settle();
  assert.equal(app.elements.errorTitle.textContent, 'Location blocked', 'static edition must explain permission denial without a server fallback');
  assert.equal(app.elements.errorCard.hidden, false);
}

{
  const app = await boot({ permission: 'denied', geolocation: 'denied', cachedLocation: true });
  assert.equal(app.geoCalls, 1);
  assert.equal(app.elements.status.textContent, 'Observed', 'cached coordinates should preserve local weather when a fresh fix fails');
}

{
  const app = await boot({ permission: 'prompt', geolocation: 'denied', policyAllows: false });
  await app.elements.refresh.click();
  await settle();
  assert.equal(app.elements.errorTitle.textContent, 'Open in browser');
  assert.equal(app.elements.openBrowser.hidden, false);
}

{
  const app = await boot({
    permission: 'granted',
    stationProperties: {
      temperature: { value: 20, unitCode: 'wmoUnit:degC' },
      dewpoint: { value: 10, unitCode: 'wmoUnit:degC' },
      timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      stationName: 'Delayed station'
    }
  });
  assert.equal(app.elements.status.textContent, 'Last reading');
  assert.match(app.elements.lastUpdated.textContent, /1 hr ago/);
}

{
  const app = await boot({
    permission: 'granted',
    stationProperties: {
      temperature: { value: 0, unitCode: 'wmoUnit:degC' },
      dewpoint: { value: -5, unitCode: 'wmoUnit:degC' },
      windSpeed: { value: 10, unitCode: 'wmoUnit:m_s-1' },
      timestamp: new Date().toISOString(),
      stationName: 'Cold station'
    }
  });
  assert.match(app.elements.heatIndex.textContent, /^Wind chill /);
  assert.equal(app.elements.heatIndex.hidden, false);
}

{
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const app = await boot({
    permission: 'granted',
    alerts: [{
      id: 'https://api.weather.gov/alerts/test-warning',
      properties: { status: 'Actual', messageType: 'Alert', event: 'Tornado Warning', severity: 'Extreme', expires }
    }]
  });
  assert.equal(app.elements.weatherAlert.hidden, false);
  assert.equal(app.elements.alertTitle.textContent, 'Tornado Warning');
  assert.match(app.elements.alertTime.textContent, /^Until /);
}

console.log('location-flow V&V: 11 scenarios passed');
