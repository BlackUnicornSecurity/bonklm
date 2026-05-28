# OpenClaw (reference)

This folder previously embedded a git submodule pointing at the upstream
[OpenClaw](https://github.com/openclaw/openclaw) repository. The submodule was removed because:

- The integration code that BonkLM actually ships lives in
  [`packages/openclaw-adapter/`](../../packages/openclaw-adapter/).
- An orphan submodule pointer (no `.gitmodules`) confused fresh clones and bloated the working tree
  (~1.2 GB).

If you need to consult the upstream OpenClaw source for adapter development, clone it locally
outside this repo:

```bash
git clone https://github.com/openclaw/openclaw.git ~/src/openclaw
```

The adapter API surface this repo targets is documented in
[`docs/openclaw-integration.md`](../../docs/openclaw-integration.md).
