const { 0: url, headers = "Content-Type, Authorization", credentials } = ctx.args.all();
if (!url) throw new Error('Usage: cors-unblock <url> [--headers "X-Api-Key"] [--credentials]');

await ctx.tabs.this().network.add({
  match: { url },
  response: {
    headers: {
      set: {
        "Access-Control-Allow-Origin": location.origin,
        "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": headers,
        ...(credentials === true ? { "Access-Control-Allow-Credentials": "true" } : {})
      }
    }
  }
});
console.log(`CORS allowed for ${url} on ${location.origin}.`);
