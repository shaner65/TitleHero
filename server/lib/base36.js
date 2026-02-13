/**
 * Encode a number as a 9-character base36 string (PRSERV-style identifier).
 * Shared by documents.js and tifProcessWorker.js.
 */
export function base36Encode(number) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  if (number === 0) {
    return chars[0].repeat(9);
  }

  let result = '';
  while (number > 0) {
    const i = number % 36;
    number = Math.floor(number / 36);
    result = chars[i] + result;
  }

  return result.padStart(9, '0');
}
