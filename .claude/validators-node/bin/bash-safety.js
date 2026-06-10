#!/usr/bin/env node
// PreToolUse:Bash hook entrypoint. Logic + tests live in lib/; see README.md.
import { runHook } from '../lib/run-hook.js';
import { validateBashSafety } from '../lib/validators/bash-safety.js';

runHook('bash-safety', validateBashSafety);
