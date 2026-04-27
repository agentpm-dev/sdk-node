# `agentpm-sdk-node` Repo Guide

This repo is the Node SDK for AgentPM.

## Purpose

- tool discovery/loading
- subprocess execution
- runtime environment handling
- Node-side developer integration

## Local Rules

- Open source
- npm distribution matters

## Builder Guidance

- Be conservative with SDK contracts.
- Keep runtime behavior predictable.
- Preserve subprocess/env semantics carefully.
- Avoid changes that make loading behavior less deterministic.

## Verification

- Verify load/runtime behavior when changing tool resolution, env handling, or subprocess execution.

## Never Do This

- Don’t change SDK contracts casually.
- Don’t regress tool discovery or env passing behavior.
