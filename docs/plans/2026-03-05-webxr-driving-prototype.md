# WebXR Driving Prototype Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome-compatible WebXR driving prototype where the player steers a car between lanes and avoids incoming traffic.

**Architecture:** Use Vite + TypeScript + Three.js for a lightweight browser runtime. Keep game behavior in a pure logic module (`src/game/logic.ts`) so it is testable with Vitest and reused by the render loop (`src/main.ts`). Start with primitive meshes and provide documented open-source asset options that can be dropped in later.

**Tech Stack:** TypeScript, Vite, Three.js, Vitest

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `.gitignore`

**Step 1: Write the failing test**

Create test runner config with no tests to establish baseline command behavior.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: fails because no test files yet.

**Step 3: Write minimal implementation**

Add package scripts/dependencies and Vitest config.

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: test command runs without config errors.

**Step 5: Commit**

```bash
git add package.json tsconfig.json vite.config.ts index.html .gitignore
git commit -m "chore: scaffold vite typescript webxr project"
```

### Task 2: Game Logic with TDD

**Files:**
- Create: `src/game/logic.ts`
- Create: `src/game/logic.test.ts`

**Step 1: Write the failing test**

Write tests for:
- lane clamp behavior
- incoming traffic movement/removal
- collision detection in same lane within hit range

**Step 2: Run test to verify it fails**

Run: `npm test -- src/game/logic.test.ts`
Expected: FAIL because `logic.ts` does not exist or exports are missing.

**Step 3: Write minimal implementation**

Implement typed pure functions:
- `nextLane(current, direction, laneCount)`
- `stepTraffic(traffic, speed, dt, despawnZ)`
- `spawnTraffic(existing, laneCount, spawnZ, rng)`
- `hasCollision(playerLane, playerZ, traffic, laneHitDistance, zHitDistance)`

**Step 4: Run test to verify it passes**

Run: `npm test -- src/game/logic.test.ts`
Expected: PASS all tests.

**Step 5: Commit**

```bash
git add src/game/logic.ts src/game/logic.test.ts
git commit -m "feat: add test-driven traffic and collision logic"
```

### Task 3: WebXR Scene Integration

**Files:**
- Create: `src/main.ts`
- Create: `src/style.css`
- Modify: `index.html`

**Step 1: Write the failing test**

Write integration-oriented unit test for a small helper if needed (for example lane-to-x conversion) before adding render code.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/game/logic.test.ts`
Expected: FAIL for the new helper assertion.

**Step 3: Write minimal implementation**

Implement Three.js scene:
- WebXR `VRButton`
- player car mesh and lane switching input
- road illusion + ambient lighting
- traffic mesh spawning and movement via logic module
- collision state + restart key

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/main.ts src/style.css index.html
git commit -m "feat: implement webxr driving loop with collision and restart"
```

### Task 4: Asset Guidance and Verification

**Files:**
- Create: `README.md`
- Create: `assets/README.md`

**Step 1: Write the failing test**

Run build before docs to catch runtime/type issues.

**Step 2: Run test to verify it fails**

Run: `npm run build`
Expected: identify and fix any compile/runtime errors.

**Step 3: Write minimal implementation**

Document:
- local run steps for Chrome + WebXR
- controls
- open-source 3D/model/audio sources and licenses
- how to swap placeholder meshes with real assets

**Step 4: Run test to verify it passes**

Run:
- `npm test`
- `npm run build`

Expected: both succeed.

**Step 5: Commit**

```bash
git add README.md assets/README.md
git commit -m "docs: add webxr setup and open-source asset guidance"
```
