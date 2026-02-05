# Ascension Earth (Digital Prototype)

A playable canvas-based prototype for **Ascension Earth** built with TypeScript + Vite. It runs locally and uses a deterministic seed for reproducible matches.

## Run Locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite (usually http://localhost:5173).

## Controls

- **Menu**: Click the seed field and type; press Enter to start.
- **Match**: Use the action buttons, then Confirm. Follow the Challenge prompts to select cards and cast spells.
- **Hotseat**: Toggle to reveal AI hands for debugging.
- **Rules**: Quick reference overlay.

## Tests

A minimal harness exists under `src/tests/harness.ts`.

In the browser console, run:

```js
runAscensionTests()
```

## AI Studio Workflow

Follow this loop for every meaningful work cycle:

Constraint Scan -> Plan -> Execute -> Plan Fidelity Review -> High-level Questions -> Update Memory

Before work, read `STUDIO_OS.md`, `VISION.md`, `STUDIO_MEMORY.md`, `DECISION_LOG.md`, and `CURRENT_STATE.md`.
After work, update memory files to reflect new state and decisions.
