import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url),'utf8');
const tags = [...html.matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"/g)];
const meta = Object.fromEntries(tags.map(m => [m[1],m[2]]));
const base = 'https://stewalexander-com.github.io/temp/';
for (const name of ['og:title','og:type','og:url','og:description','og:image','og:image:alt','twitter:card','twitter:title','twitter:description','twitter:image','twitter:image:alt']) assert.ok(meta[name], name);
assert.equal(meta['og:url'],base);
assert.equal(meta['twitter:card'],'summary_large_image');
assert.equal(meta['og:image'],meta['twitter:image']);
assert.ok(html.includes(`<link rel="canonical" href="${base}">`));
const image = fs.readFileSync(new URL('../docs/social-card-v1.jpg',import.meta.url));
assert.equal(image.readUInt16BE(0),0xffd8,'JPEG signature');
assert.equal(meta['og:image:type'],'image/jpeg');
assert.equal(meta['og:image:width'],'1200');
assert.equal(meta['og:image:height'],'496');
const manifest = JSON.parse(fs.readFileSync(new URL('../docs/manifest.webmanifest',import.meta.url),'utf8'));
for (const field of ['id','scope','start_url']) assert.equal(new URL(manifest[field],base).href,base);
assert.equal(manifest.display,'standalone');
for (const icon of manifest.icons) {
 const file=fs.readFileSync(new URL('../docs/'+icon.src,import.meta.url));
 assert.equal(`${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`,icon.sizes);
}
const apple = fs.readFileSync(new URL('../docs/apple-touch-icon.png',import.meta.url));
assert.equal(apple.readUInt32BE(16),180);assert.equal(apple.readUInt32BE(20),180);
console.log('Sharing and home-screen metadata checks passed');
