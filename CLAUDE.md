# `agentpm-sdk-node` Repo Review Guide

This repo is the Node runtime integration layer.

## Review Focus

- load-path correctness
- subprocess behavior
- env passing behavior
- SDK contract stability
- npm-facing compatibility risk

## Blocking Issues

- broken load semantics
- env handling regressions
- subprocess contract regressions
- unintended public API drift

## Preferred Emphasis

- correctness
- compatibility
- runtime determinism
