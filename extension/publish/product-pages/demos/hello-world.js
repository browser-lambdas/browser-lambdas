// Run in Browser Lambdas: hello-world --verbose
const greeting = 'Welcome to Browser Lambdas';
const border = '+' + '-'.repeat(greeting.length + 2) + '+';
console.log(border);
console.log(`| ${greeting} |`);
console.log(border);

if (ctx.args.all().verbose) {
  console.log([
    '',
    '+ Bend the DOM at will',
    '+ Rich runtime API',
    '  + Create, control and destroy tabs',
    '  + Persist data across functions calls',
    '  + Compose multiple functions',
    '  + Fetch secrets securely',
    '+ Keep functions, triggers and styling in git',
    '  and sync with extension',
    '  + Install baah CLI tool',
    '    (npm i -g @browser-lambdas/baah)',
    '+ You decide if functions run in:',
    '  + isolated user world or in',
    '    (dangerous, but powerful) main world'
  ].join('\n'));
}
