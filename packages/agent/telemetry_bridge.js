import crypto from 'crypto';

export function generateSlotSeededTelemetry(slot) {
  return {
    heartRate: 65 + (slot % 15),
    eeg: 38 + (slot % 12),
  };
}

export function maskTelemetry({ heartRate, eeg, slot }) {
  const jitter = slot === undefined ? 2 : slot % 2 === 0 ? 2 : -2;
  const maskedHeartRate = heartRate + jitter;
  const maskedStateHash = crypto
    .createHash('sha256')
    .update(`stream-${maskedHeartRate}-${eeg}`)
    .digest('hex');
  return { maskedHeartRate, maskedStateHash };
}
