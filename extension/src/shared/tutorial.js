import { newLambda, newStorageItem, newSecret, newTrigger } from './records.js';

export const TUTORIAL_STATUS_KEY = 'local_storage_key_tutorial_status';
export const TUTORIAL_PROJECT = 'treasure hunt';
const urls = ['https://browser-lambdas.dev/*', 'https://www.browser-lambdas.dev/*'];

const begin = `// Start a new hunt. Progress is saved as the number of completed challenges.
if (!await ctx.kv.set("tutorial-progress", 0)) {
  throw new Error("The hunt could not start. Check access to tutorial-progress.");
}
console.log("Welcome to the docs treasure hunt\\nFind the answers to the 3 challenges\\nAnd complete the tutorial\\n\\nUse \\\"answer\\\" to test an answer and receive the hint for the next challenge.\\nFirst hint: What ctx API can be used to store persistent values?");`;

const answer = `const { 0: input = "" } = ctx.args.all();
const progress = await ctx.kv.get("tutorial-progress");
const challenges = [
  { secret: "tutorial-answer-1", hint: "What ctx API can be used to store persistent values?" },
  { secret: "tutorial-answer-2", hint: "What is the name of the CLI tool that can sync functions with the extension?" },
  { secret: "tutorial-answer-3", hint: "What .txt file can be used to give your agent the entire docs of this site?" }
];

if (progress === null) {
  console.log("Type begin to start the treasure hunt.");
  return;
}
if (!Number.isInteger(progress) || progress < 0 || progress > challenges.length) {
  throw new Error("The saved progress is invalid. Run begin to start a new hunt.");
}
if (progress === challenges.length) {
  console.log("You have already completed the treasure hunt! Run begin to play again.");
  return;
}
if (!String(input).trim()) {
  console.log("Use answer <your answer> to test an answer.\\n\\nHint: " + challenges[progress].hint);
  return;
}
const expected = await ctx.secrets.get(challenges[progress].secret);
if (typeof expected !== "string" || !expected.trim()) {
  throw new Error("The answer secret is unavailable. Check access to " + challenges[progress].secret + " and try again.");
}
if (String(input).trim().toLowerCase() !== expected.trim().toLowerCase()) {
  console.log("Not quite! Try again.\\n\\nHint: " + challenges[progress].hint);
  return;
}

const completed = progress + 1;
if (!await ctx.kv.set("tutorial-progress", completed)) {
  throw new Error("Your progress could not be saved. Check access to tutorial-progress and try again.");
}
if (completed === challenges.length) {
  console.log("Congratulations!\\n\\nYou have completed the treasure hunt and hopefully feel a little more familiar with Browser Lambdas.");
} else {
  const heading = completed === 1 ? "Next hint:" : "Final hint:";
  console.log("Correct!\\n\\n" + completed + "/3 completed!\\n\\n" + heading + "\\n" + challenges[completed].hint);
}`;

const deactivateDemo = `// Turn off only the website's mock terminal, leaving the extension Terminal available.
window.dispatchEvent(new Event("browser-lambdas-deactivate-demo"));`;

export function tutorialResources() {
  const restrict = item => ({ ...item, urlAllowlistEnabled: true, urlPatterns: [...urls] });
  const caller = item => ({ ...restrict(item), projectsEnabled: true, allowedProjects: [TUTORIAL_PROJECT] });
  return {
    lambdas: [restrict(newLambda('begin', begin, TUTORIAL_PROJECT)), restrict(newLambda('answer', answer, TUTORIAL_PROJECT)), restrict(newLambda('deactivate-demo', deactivateDemo, TUTORIAL_PROJECT))],
    storage: [caller(newStorageItem('tutorial-progress', null))],
    secrets: ['ctx.kv.get()', 'baah', 'llms.txt'].map((value, index) => caller(newSecret(`tutorial-answer-${index + 1}`, value))),
    triggers: [newTrigger('deactivate-demo', urls, ['deactivate-demo'], TUTORIAL_PROJECT)]
  };
}
