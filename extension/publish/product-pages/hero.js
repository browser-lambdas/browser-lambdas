// Share the campaign artwork, then give the brand and values separate columns.
const response = await fetch('05-campaign.html');
if (!response.ok) throw new Error('Could not load campaign artwork.');
const source = new DOMParser().parseFromString(await response.text(), 'text/html');
const artwork = document.importNode(source.querySelector('.campaign-slide'), true);
artwork.setAttribute('aria-label', 'Browser Lambdas — Free, Secure, Private and Open Source');
const heading = document.createElement('p');
heading.className = 'hero-eyebrow';
heading.textContent = 'Hack your browsing.';
artwork.append(heading);
const sparkles = artwork.querySelector('.campaign-sparkles');
sparkles.innerHTML = `
  <path d="m95 210 9 21 21 9-21 9-9 21-9-21-21-9 21-9z"/>
  <path d="m620 125 7 16 16 7-16 7-7 16-7-16-16-7 16-7z"/>
  <path d="m600 680 6 14 14 6-14 6-6 14-6-14-14-6 14-6z"/>`;
const values = document.createElement('ul');
values.className = 'hero-values';
for (const label of ['Free', 'Secure', 'Private', 'Open Source']) {
  const item = document.createElement('li');
  item.textContent = `${label}.`;
  values.append(item);
}
artwork.append(values);
document.querySelector('.hero-viewport').append(artwork);
document.documentElement.dataset.ready = 'true';
