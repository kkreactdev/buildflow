/** Cards per row for a group of n cards: all of them up to four, otherwise a count that leaves no ragged last row. */
export function columnsFor(n) {
  if (n <= 4) return Math.max(1, n);
  if (n === 6) return 6; // wide: one row; the CSS drops it to 3 then 2 as the dashboard narrows
  if (n % 3 === 0) return 3;
  if (n % 4 === 0) return 4;
  return n === 5 ? 5 : 4;
}
