# Temp°

A large, readable local weather poster, packaged for your computer and GitHub.
Exported September 15, 2026 from Temp° version 27.

## Location recovery update

If device location is blocked in a desktop viewer, Facebook, or a home-screen app, enter a city or ZIP and select the matching place. It is remembered when browser storage is available. Use device location remains optional. NWS failures can fall back to a clearly labeled Open-Meteo model estimate. See [the RCA, five hardening passes, and verification limits](HARDENING.md).

## Start here

Unzip this bundle. The `docs` folder is the ready-to-publish website: no Node.js,
package installation, API key, or build step is needed to host it.

| Included | Purpose |
| --- | --- |
| `docs/` | Editable HTML, CSS, JavaScript, and home-screen icons for GitHub Pages. |
| `Temp-original-source-v27.zip` | Complete original tracked source, including server routes, artwork, dependency lockfile, and existing tests. |
| `tests/location-flow.test.mjs` | Behavior checks adapted for the GitHub Pages edition. |
| `EXPORT-NOTES.md` | Provenance, compatibility changes, and verification results. |

## Publish as a separate GitHub Pages project

1. Create a repository in your GitHub account, for example `temp`.
2. Upload the **contents of this unzipped Temp folder** to the repository's `main`
   branch. Keep `docs` as a folder directly inside the repository; do not upload
   only the outer ZIP or add another enclosing `Temp` folder.
3. In the repository, open **Settings → Pages**. Under **Build and deployment**,
   choose **Deploy from a branch**, select **main**, choose **/docs**, and save.
4. Once deployment finishes, open the HTTPS address shown by GitHub Pages.
   With the example repository name, the expected address is
   `https://StewAlexander-com.github.io/temp/`.
5. Tap **Use my location** and allow location access. You can then add the page
   to your home screen; the supplied name is **Temp°**.

Reference: [GitHub's publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Add to your existing GitHub website

Copy the **contents of `docs`** into a new `temp` directory inside your existing
website's published folder. For a site published from the repository root, that
means `temp/index.html`; for a site published from `docs`, use
`docs/temp/index.html`. Keep the accompanying icons and files together.
Use the trailing-slash address, such as `https://StewAlexander-com.github.io/temp/`.
An existing custom build must copy these static files into its published output.

## Run on your computer

With Python 3 installed, open a terminal in this unzipped Temp folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory docs
```

On Windows, use `py -m http.server 8000 --bind 127.0.0.1 --directory docs`.
Open `http://localhost:8000/` and allow location when requested.
Use this local server instead of double-clicking `index.html`. Phone testing
should use the published HTTPS site. Internet access is required for fresh weather.

## What the Pages edition preserves

- Large Fahrenheit temperature, dew point and humidity, plus conditional heat
  index or wind chill and active NWS warning display.
- The sky gradient, diffuse thermal halo, responsive layout, and Temp° icons.
- Device location, recent saved-location fallback, cached last reading,
  timestamps, visible errors, and retry controls.
- Automatic updates every 15 minutes after location use begins, and on return
  to the page. Browsers may suspend timers when the page is in the background.

## Server-dependent differences

GitHub Pages hosts static files. This edition therefore omits the IP-based
approximate-location fallback and shared live-temperature social-preview image.
It does not call the old site's server. Location denial offers city/ZIP selection,
or uses a recent location saved on the device when one exists. Social metadata
has a fixed description and no dynamic weather image.

Both server features remain intact in `Temp-original-source-v27.zip` for a future
server-backed deployment. That source uses Vinext/React and Cloudflare Workers,
with an R2 `BUCKET` binding. It is an archival source export, not a drop-in GitHub
Pages application; deployment elsewhere requires configuring that runtime and
storage and changing the original hard-coded site origin. Dependencies and
remote stored data are not bundled. Source runtime versions are recorded in
`package.json` and `pnpm-lock.yaml`.

## Data and editing

The client requests weather from `api.weather.gov`, with Open-Meteo model data as a fallback. City/ZIP searches go to Open-Meteo (GeoNames place data); weather coordinates go to the weather providers. Selected places and recent readings are saved in this browser's local storage.
No private location history or server bucket contents are included in this ZIP.
Weather availability depends on NWS coverage and service availability.

Edit `docs/index.html` for markup, `docs/styles.css` for appearance, and
`docs/app.js` for behavior. All local asset and installation paths are relative,
so the site can live at a domain root or inside a repository/subfolder.

Optional regression check (Node.js installed):

```sh
node tests/location-flow.test.mjs
```

The bundle does not assign a new license to your project. The original source
retains its included third-party license notice.
