#!/usr/bin/env node
// PreToolUse:Write/Edit/NotebookEdit hook entrypoint. Logic + tests live in lib/.
import { runHook } from '../lib/run-hook.js';
import { validateSecret } from '../lib/validators/secret.js';

runHook('secret', validateSecret);
