---
name: login-lockout-excludes-policy-failures
title: Password-policy validation failures must not increment the per-account login lockout
status: accepted
date: 2026-06-15
deciders: [ItsLucky23]
tags: [security, login, dos]
supersedes: []
relates: []
---

## Context

The login branch ran full password-policy validation and a policy failure tripped the per-account lockout counter (M-15). An attacker could therefore lock ANY victim out of their account by POSTing policy-violating passwords for the victim's email — no real-password guess required — turning the lockout protection into a remote denial-of-service.

## Decision

Password-policy validation is gated to the REGISTER path only (`validateCredentialsShape` runs the policy when `mode === 'register'`); the login branch skips it. The lockout counter excludes policy/validation reasons (`NON_COUNTING_REASONS`) and only records on a genuine `login.wrongPassword`. So a policy-invalid login attempt no longer trips the lockout, while a real wrong-password attempt still does.

## Rejected alternatives

- **Keep counting every failed login attempt (incl. policy failures)** — rejected: lets an unauthenticated attacker lock any account by name, converting a defense into a DoS vector.
- **Drop the lockout entirely to avoid the DoS** — rejected: removes a real brute-force defense; the correct fix is to count only genuine wrong-password attempts.

## Consequences

An attacker can no longer lock a victim via policy-violating passwords. Real credential-stuffing/brute-force still trips the lockout. A test pins that a policy-invalid attempt does not lock while a real wrong-password does.
