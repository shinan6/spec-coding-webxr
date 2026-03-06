# Traffic AI 2.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement dynamic traffic AI with lane changes, overtaking, reactive braking, and driver profiles for issue #1.

**Architecture:** Keep `src/game/logic.ts` as the deterministic simulation layer and extend `TrafficVehicle` with AI state. Add test-first behavior coverage in `src/game/logic.test.ts`, then integrate new spawn and simulation calls from `src/main.ts` without changing core rendering responsibilities.

**Tech Stack:** TypeScript, Vitest, Three.js runtime integration in Vite.

---

### Task 1: Extend simulation types and spawn metadata

**Files:**
- Modify: `src/game/logic.ts`
- Test: `src/game/logic.test.ts`

1. Add failing tests for driver profile selection and AI state defaults during spawn/initial traffic creation.
2. Implement profile typing (`slow|normal|aggressive`) and weighted profile selection from RNG.
3. Extend vehicle state with lane-change cooldown and profile-specific behavior parameters.
4. Verify tests pass.

### Task 2: Add lane-change safety and overtaking decisions

**Files:**
- Modify: `src/game/logic.ts`
- Test: `src/game/logic.test.ts`

1. Add failing tests for safe lane changes and blocked lane changes.
2. Implement deterministic lane-change decision pipeline:
   - detect forward blocker
   - evaluate adjacent lanes with safety gap checks
   - apply cooldown after lane changes
3. Verify tests pass.

### Task 3: Add reactive braking and profile-sensitive speed behavior

**Files:**
- Modify: `src/game/logic.ts`
- Test: `src/game/logic.test.ts`

1. Add failing tests for braking when forward gap is tight and for profile speed differences.
2. Implement target-speed calculation and smooth speed adaptation under blockage.
3. Ensure overtaking + braking interplay remains deterministic.
4. Verify tests pass.

### Task 4: Integrate runtime usage in game loop

**Files:**
- Modify: `src/main.ts`
- Modify: `README.md`

1. Update spawn calls to include profile-weight inputs (or defaults).
2. Update traffic step call to use new AI options while preserving existing game systems.
3. Document new traffic AI behavior in README.
4. Run full verification (`npm test`, `npm run build`).
