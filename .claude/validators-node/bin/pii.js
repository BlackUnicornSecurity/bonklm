#!/usr/bin/env node
// PreToolUse:Write/Edit/NotebookEdit/TodoWrite hook entrypoint. Logic + tests live in lib/.
import { runHook } from '../lib/run-hook.js';
import { validatePii } from '../lib/validators/pii.js';

runHook('pii', validatePii);
