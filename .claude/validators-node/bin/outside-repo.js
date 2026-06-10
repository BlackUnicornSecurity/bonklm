#!/usr/bin/env node
// PreToolUse hook entrypoint. Wired on Bash/Write/Edit/Read/Glob/Grep, but only
// acts on Write/Edit/NotebookEdit (a pass-through elsewhere). Logic + tests in lib/.
import { runHook } from '../lib/run-hook.js';
import { validateOutsideRepo } from '../lib/validators/outside-repo.js';

runHook('outside-repo', validateOutsideRepo);
