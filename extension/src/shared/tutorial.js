import { newLambda, newSecret } from './records.js';

export const TUTORIAL_STATUS_KEY = 'local_storage_key_tutorial_status';
export const TUTORIAL_PROJECT = 'Demo Lambdas';
const urls = ['https://browser-lambdas.dev/*', 'https://www.browser-lambdas.dev/*'];

const quiz = `/*
The Docs Quiz

This demo lambda shows you how secrets can be used in a fun way.
Navigate to browser-lambdas.dev and type "quiz me" on each page.
The lambda will fetch the secrets (via ctx.secrets) and give you
a question to answer about the page. You can then read the docs
and use "quiz reply <reply>" to check if you learned something..
*/
const { 0: command, 1: input = "" } = ctx.args.all();
if (command !== "me" && command !== "reply") {
  console.log("Use quiz me for a hint, or quiz reply <reply> to test an answer.");
  return;
}
const secret = JSON.parse(await ctx.secrets.get("tutorial-quiz"));
const section = document.querySelector(".doc-group:not([hidden])").dataset.category;
const { hint, answer } = secret[section];
if (command === "me") {
  console.log("Hint: " + hint);
  return;
}
if (String(input).trim().toLowerCase() !== answer.trim().toLowerCase()) {
  console.log("Not quite! Try again.\\n\\nHint: " + hint);
  return;
}
console.log("Correct! Try another page.");`;

export function tutorialResources() {
  const restrict = item => ({ ...item, urlAllowlistEnabled: true, urlPatterns: [...urls] });
  const caller = item => ({ ...restrict(item), projectsEnabled: true, allowedProjects: [TUTORIAL_PROJECT] });
  return {
    lambdas: [restrict(newLambda('quiz', quiz, TUTORIAL_PROJECT))],
    secrets: [caller(newSecret('tutorial-quiz', JSON.stringify({
      intro: { hint: 'What language are Browser Lambdas functions written in?', answer: 'JavaScript' },
      demo: { hint: 'Which preloaded demo function greets you by name?', answer: 'hello' },
      'quick-start': { hint: 'Which baah subcommand syncs your project to the extension?', answer: 'push' },
      ctx: { hint: 'What ctx API can be used to store persistent values?', answer: 'ctx.kv.get()' },
      baah: { hint: 'What is the name of the CLI tool that can sync functions with the extension?', answer: 'baah' },
      security: { hint: 'What must synced changes pass by default before they can run?', answer: 'review' },
      llms: { hint: 'What .txt file can be used to give your agent the entire docs of this site?', answer: 'llms.txt' }
    }, null, 2)))]
  };
}
