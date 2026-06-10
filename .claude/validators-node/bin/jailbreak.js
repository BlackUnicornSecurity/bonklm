#!/usr/bin/env node
// UserPromptSubmit hook entrypoint. Logic + tests live in lib/.
import { runHook } from '../lib/run-hook.js';
import { validateJailbreak } from '../lib/validators/jailbreak.js';

runHook('jailbreak', validateJailbreak);
