// Share the source artwork with the small tile; only rearrange its composition.
const response = await fetch('05-campaign.html');
if (!response.ok) throw new Error('Could not load campaign artwork.');
const source = new DOMParser().parseFromString(await response.text(), 'text/html');
const artwork = document.importNode(source.querySelector('.campaign-slide'), true);
const clouds = artwork.querySelector('.campaign-clouds');
clouds.setAttribute('preserveAspectRatio', 'xMidYMid slice');
const wordmark = artwork.querySelector('.campaign-wordmark');
wordmark.setAttribute('viewBox', '0 0 1400 560');
for (const [index, text] of [...wordmark.querySelectorAll('text')].entries()) {
  text.setAttribute('x', '930');
  text.setAttribute('y', index === 0 ? '286' : '400');
  text.setAttribute('textLength', index === 0 ? '730' : '780');
}
const sparkles = artwork.querySelector('.campaign-sparkles');
sparkles.setAttribute('viewBox', '0 0 1400 560');
sparkles.innerHTML = `
  <path d="m90 151 10 23 23 10-23 10-10 23-10-23-23-10 23-10z"/>
  <path d="m1280 93 10 23 23 10-23 10-10 23-10-23-23-10 23-10z"/>
  <path d="m1210 454 7 16 16 7-16 7-7 16-7-16-16-7 16-7z"/>`;
document.querySelector('.campaign-wide').append(artwork);
document.documentElement.dataset.ready = 'true';
