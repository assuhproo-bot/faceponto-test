/**
 * Keeps the time editor friendly for a keypad: 831 becomes 08:31 and 0831
 * remains 08:31. Validation is deliberately left to the form so a person can
 * still correct an incomplete value without the field fighting their typing.
 */
export function normalizeClockInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (!digits) return '';
  if (digits.length <= 2) return digits.padStart(2, '0');
  if (digits.length === 3) {
    return digits.startsWith('0') ? `${digits.slice(0, 2)}:${digits.slice(2)}` : `0${digits.slice(0, 1)}:${digits.slice(1)}`;
  }
  const padded = digits.padStart(4, '0');
  return `${padded.slice(0, 2)}:${padded.slice(2)}`;
}

/**
 * Formats while someone types without padding the first digit too early. That
 * keeps `14:30`, `08:31` and keypad shorthand `831` possible in one field.
 */
export function formatClockTyping(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length < 2) return digits;
  if (digits.length === 2 && Number(digits[0]) > 2) return `0${digits[0]}:${digits[1]}`;
  if (digits.length <= 2) return digits;
  if (digits.length === 3 && Number(digits.slice(0, 2)) > 23) return `0${digits[0]}:${digits.slice(1)}`;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function isValidClockInput(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const hours = Number(value.slice(0, 2));
  const minutes = Number(value.slice(3, 5));
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}
