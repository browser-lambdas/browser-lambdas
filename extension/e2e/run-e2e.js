#!/usr/bin/env node
import { spawnSync } from 'child_process';

const args = process.argv.slice(2);
let reactionTime = process.env.REACTION_TIME || '500';
let headless = false;
const idx = args.findIndex(
	(arg) => arg === '--reaction-time' || arg.startsWith('--reaction-time=')
);
if (idx !== -1) {
	const arg = args[idx];
	if (arg.includes('=')) {
		reactionTime = arg.split('=')[1];
		args.splice(idx, 1);
	} else {
		reactionTime = args[idx + 1];
		args.splice(idx, 2);
	}
}

const headlessIndex = args.indexOf('--headless');
if (headlessIndex !== -1) {
	headless = true;
	args.splice(headlessIndex, 1);
}
process.env.REACTION_TIME = reactionTime;
if (headless) process.env.HEADLESS = '1';
const result = spawnSync('npx', ['playwright', 'test', ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
