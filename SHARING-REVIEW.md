# Live-site sharing and home-screen review

Target: https://stewalexander-com.github.io/temp/

## Three passes

1. **Home-screen setup:** confirmed the 180×180 Apple touch icon and the 192×192 and 512×512 Android manifest icons exist at their declared dimensions. Manifest ID, scope and start URL resolve to `/temp/`; display is standalone. The existing 512px icon has opaque background and the central symbol visually fits Android's central maskable safe area. Actual launcher installation was not available for testing. No offline launch capability is claimed.
2. **Sharing and discovery:** found missing `og:image`, `og:url`, canonical URL and X card tags. Added a public static JPEG sharing card, absolute HTTPS image URLs, image dimensions/type/alt text, Open Graph title/description/site identity, X large-image metadata, canonical link, robots metadata and a single-page sitemap. The card identifies the app and does not imply a current temperature. These tags are in initial HTML and do not require JavaScript or location permission.
3. **Delivery validation:** automated checks cover required metadata, canonical identity, image signature and declared dimensions, manifest scope, and icon dimensions. Public HTTP checks verify the deployed HTML and assets. Fetching with crawler-like user-agent strings checks delivery, not platform rendering or cache state. Facebook, Messenger, X, LinkedIn, Apple Messages and Android messaging app previews have not been individually rendered in their apps.

## Five-why RCA

1. **Why could a shared link lack a rich image?** The published HTML did not specify an Open Graph image or X card.
2. **Why was no image specified?** The static export intentionally omitted its old server-generated weather image and did not provide a static replacement (documented in EXPORT-NOTES.md).
3. **Why did adding the README hero not fix sharing?** GitHub renders that Markdown separately; preview services inspect the linked github.io page's initial HTML.
4. **Why did the gap survive verification?** Earlier tests targeted location/weather behavior, assets and visible UI; they did not assert social metadata.
5. **Why was “published and working” insufficient?** A functioning interactive page and crawler-readable sharing information are separate acceptance checks. The metadata regression check now makes that distinction explicit.

## Platform coverage and limits

- Facebook/Messenger and LinkedIn: standard Open Graph title, description, URL and image supplied.
- X: explicit `summary_large_image` card and title, description, image and alt text supplied.
- Apple Messages: Open Graph image/title plus a high-resolution Apple touch icon supplied.
- Android messaging apps: the same public metadata is available; preview support depends on the individual app and user settings. Plain SMS has no universal rich-preview requirement.
- iPhone/Android home screens: icons and manifest are configured; device-specific installation and permissions require physical device verification.

Cached cards may lag behind a deployment. Facebook's Sharing Debugger and LinkedIn's Post Inspector can re-fetch the public URL. Existing sent messages may retain older previews. No platform account identifiers were invented, no messages were sent, and no full cross-platform rendering guarantee is made.

## References

- https://ogp.me/
- https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages
- https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
- https://www.linkedin.com/help/linkedin/answer/a521928/making-your-website-shareable-on-linkedin
- https://web.dev/articles/maskable-icon

The legacy X card documentation URL redirected to its general documentation overview during this review; exact current X rendering was not verified.
