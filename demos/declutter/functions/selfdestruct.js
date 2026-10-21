const STORAGE_KEY = "self-destruct-paths";

const { 0: mode, 1: action, inactiveSecs } = ctx.args.all();
const automatic = mode === 'auto';
const path = location.origin + location.pathname;
let seconds = Number(inactiveSecs ?? 60);

if (automatic) {
  const paths = await ctx.kv.get(STORAGE_KEY) ?? {};
  if (action === 'this' || (inactiveSecs !== undefined && paths[path] !== undefined)) paths[path] = seconds;
  if (action === 'not-this') delete paths[path];
  if (action || inactiveSecs !== undefined) await ctx.kv.set(STORAGE_KEY, paths);
  if (paths[path] === undefined) return;
  seconds = Number(paths[path]);
}

console.log(`This tab closes after ${seconds}s without page activity.`);

const listeners = new AbortController();
await new Promise((resolve) => {
  let timer;
  const reset = (event) => {
    if (event && (!event.isTrusted || (event.type === 'visibilitychange' && document.hidden))) return;
    clearTimeout(timer);
    timer = setTimeout(resolve, seconds * 1000);
  };
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus', 'visibilitychange']) {
    window.addEventListener(type, reset, { capture: true, passive: true, signal: listeners.signal });
  }
  reset();
});
listeners.abort();

if (!automatic || (await ctx.kv.get(STORAGE_KEY))[location.origin + location.pathname] !== undefined) {
  await ctx.tabs.this().close();
}
