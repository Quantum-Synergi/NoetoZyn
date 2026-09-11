/**
 * interactive_ui.js
 * Quantum Synergi - NoetoZyn Agent Core
 *
 * A self-contained terminal UI (Node built-ins only -- readline + crypto)
 * that lets a hackathon judge:
 *   [SPACE] toggle the biological firewall (shield) on/off
 *   [UP/DOWN]   adjust simulated heart rate (bpm)
 *   [LEFT/RIGHT] adjust simulated EEG amplitude (uV)
 *   [q]  quit
 *
 * The state loop runs continuously, recomputing the masked telemetry and
 * "on-chain" checkpoint hash every tick, and redraws the terminal in place.
 */

import readline from 'readline';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// ANSI helpers (no external chalk/blessed dependency required)
// ---------------------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
};

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[0f');
}

function color(text, code) {
  return `${code}${text}${ANSI.reset}`;
}

function bar(value, min, max, width = 30) {
  const clamped = Math.max(min, Math.min(max, value));
  const filled = Math.round(((clamped - min) / (max - min)) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------

const state = {
  heartRate: 72,
  eeg: 44.8,
  shieldActive: true,
  tick: 0,
  streamId: crypto.randomBytes(16).toString('hex'),
  logLines: [],
  breakerEvents: 0,
};

const HR_MIN = 40;
const HR_MAX = 180;
const EEG_MIN = 5;
const EEG_MAX = 100;
const MAX_LOG_LINES = 8;

function pushLog(line) {
  const timestamp = new Date().toLocaleTimeString();
  state.logLines.push(`${color(timestamp, ANSI.gray)}  ${line}`);
  if (state.logLines.length > MAX_LOG_LINES) {
    state.logLines.shift();
  }
}

function computeMaskedState() {
  if (!state.shieldActive) {
    return {
      maskedHeartRate: state.heartRate,
      maskedStateHash: null,
      note: 'SHIELD OFF -- telemetry passing through unmasked',
    };
  }

  const jitter = Math.random() > 0.5 ? 2 : -2;
  const maskedHeartRate = state.heartRate + jitter;
  const maskedStateHash = crypto
    .createHash('sha256')
    .update(`stream-${maskedHeartRate}-${state.eeg.toFixed(1)}-${state.tick}`)
    .digest('hex');

  return { maskedHeartRate, maskedStateHash, note: 'shield active' };
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function render() {
  clearScreen();

  const shieldLabel = state.shieldActive
    ? color(' ● SHIELD ACTIVE ', ANSI.bold + ANSI.green)
    : color(' ○ SHIELD OFFLINE ', ANSI.bold + ANSI.red);

  console.log(color('=====================================================', ANSI.cyan));
  console.log(color('  QUANTUM SYNERGI  //  NOETOZYN BIOMETRIC FIREWALL', ANSI.bold + ANSI.cyan));
  console.log(color('=====================================================', ANSI.cyan));
  console.log('');
  console.log(`  Status: ${shieldLabel}   Stream: ${color(state.streamId.slice(0, 12) + '...', ANSI.gray)}`);
  console.log('');

  console.log(
    `  Heart Rate   ${color(state.heartRate.toString().padStart(3) + ' bpm', ANSI.yellow)}  ` +
      `[${bar(state.heartRate, HR_MIN, HR_MAX)}]`
  );
  console.log(
    `  EEG Amplitude ${color(state.eeg.toFixed(1).padStart(5) + ' uV', ANSI.magenta)} ` +
      `[${bar(state.eeg, EEG_MIN, EEG_MAX)}]`
  );
  console.log('');

  const masked = computeMaskedState();

  console.log(color('  --- LIVE MASKING OUTPUT -------------------------------', ANSI.dim));
  if (state.shieldActive) {
    console.log(`  Masked HR:     ${color(masked.maskedHeartRate + ' bpm', ANSI.green)}`);
    console.log(`  Checkpoint:    ${color('0x' + masked.maskedStateHash.slice(0, 32) + '...', ANSI.green)}`);
  } else {
    console.log(`  Masked HR:     ${color(masked.maskedHeartRate + ' bpm  (== raw, unprotected)', ANSI.red)}`);
    console.log(`  Checkpoint:    ${color('none -- circuit breaker engaged', ANSI.red)}`);
  }
  console.log(`  Note:          ${color(masked.note, ANSI.dim)}`);
  console.log('');

  console.log(color('  --- EVENT LOG ------------------------------------------', ANSI.dim));
  if (state.logLines.length === 0) {
    console.log(color('  (no events yet)', ANSI.gray));
  } else {
    for (const line of state.logLines) {
      console.log('  ' + line);
    }
  }
  console.log('');

  console.log(color('  --------------------------------------------------------', ANSI.dim));
  console.log(
    '  ' +
      color('[SPACE]', ANSI.bold) +
      ' toggle shield   ' +
      color('[↑/↓]', ANSI.bold) +
      ' heart rate   ' +
      color('[←/→]', ANSI.bold) +
      ' EEG   ' +
      color('[q]', ANSI.bold) +
      ' quit'
  );
  console.log(color('  --------------------------------------------------------', ANSI.dim));
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

function setupInput() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      shutdown();
      return;
    }

    switch (key.name) {
      case 'space':
        state.shieldActive = !state.shieldActive;
        state.breakerEvents += 1;
        pushLog(
          state.shieldActive
            ? color('trigger_circuit_breaker -- shield RE-ARMED', ANSI.green)
            : color('trigger_circuit_breaker -- shield DEACTIVATED (reason_code=0)', ANSI.red)
        );
        break;
      case 'up':
        state.heartRate = Math.min(HR_MAX, state.heartRate + 2);
        break;
      case 'down':
        state.heartRate = Math.max(HR_MIN, state.heartRate - 2);
        break;
      case 'right':
        state.eeg = Math.min(EEG_MAX, +(state.eeg + 1.5).toFixed(1));
        break;
      case 'left':
        state.eeg = Math.max(EEG_MIN, +(state.eeg - 1.5).toFixed(1));
        break;
      case 'q':
        shutdown();
        break;
      default:
        break;
    }

    render();
  });
}

let tickInterval = null;

function shutdown() {
  if (tickInterval) clearInterval(tickInterval);
  clearScreen();
  console.log(color('NoetoZyn interactive session ended.', ANSI.cyan));
  console.log(`Total circuit-breaker toggles this session: ${state.breakerEvents}`);
  process.stdin.setRawMode?.(false);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  pushLog('interactive_ui.js started -- awaiting judge input');
  render();
  setupInput();

  tickInterval = setInterval(() => {
    state.tick += 1;
    // small ambient drift so the display feels "alive" even with no keypresses
    state.heartRate = Math.max(
      HR_MIN,
      Math.min(HR_MAX, state.heartRate + (Math.random() > 0.5 ? 1 : -1))
    );
    render();
  }, 1500);
}

main();
