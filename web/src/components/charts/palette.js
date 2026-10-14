/** Categorical series colours, in order. Status-specific colours are chosen by the caller from the record's own key. */
export const SERIES = ['#0d9488', '#2563eb', '#7c3aed', '#d97706', '#dc2626', '#16a34a', '#0891b2', '#db2777'];
export const seriesColor = (i) => SERIES[i % SERIES.length];
