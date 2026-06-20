---
id: bonklm-coverage-ratchet
tier: tier-1-required
title: Coverage ratchet — core 82/86/76/82, connectors 60% floor
applies_to: [all]
priority: 20
---
Coverage thresholds in `vitest.config.ts` are a **ratchet floor** — they only move up, never down. Per CLAUDE.md and CONTRIBUTING.md, 100% coverage is the standard; less is not acceptable.

**Enforced thresholds by scope:**
| Scope | Lines | Functions | Branches | Statements |
|-------|-------|-----------|----------|------------|
| Global floor | 60% | 60% | 50% | 60% |
| `packages/core/src/**/*.ts` | 82% | 86% | 76% | 82% |
| `packages/core/src/testing/**` | 60% | 60% | 50% | 60% |
| `tools/check-changeset-linked.js` | 100% | 100% | 100% | 100% |
| `tools/check-workspace-policy.js` | 100% | 100% | 100% | 100% |
| `tools/check-ee-boundary.js` | 100% | 100% | 100% | 100% |

Core package thresholds were ratcheted 2026-05-28 (from 80/80/75/80 to 82/86/76/82) after restoring coverage on three `src/` files and adding unit + regression suites for content-extractor, adapt-validator, wrap-sentinel, and portable-emitter. Measured aggregate at ratchet: lines 83.29 / statements 82.98 / branches 76.18 / functions 87.54. Floors sit ~1pp below to absorb normal churn.

Connectors use a relaxed 60% floor — they catch wire-up regressions (e.g., missing `hasUnvalidatedTail()` calls) without requiring full unit coverage of mocked SDK paths.

**Tests must fail when the fix is removed.** A test that still passes after sanitizer / guard removal is not a regression test — it is a happy-path test. Integration tests are preferred over contract-lock tests for catching regressions.
