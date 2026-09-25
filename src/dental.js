// FDI (ISO 3950) tooth notation — the single dental numbering source of truth.
// Stored tooth numbers are ALWAYS FDI two-digit codes; charts, prints, invoice
// lines and validation all derive from these tables.

export const ADULT_QUADRANTS = {
  upperRight: [18, 17, 16, 15, 14, 13, 12, 11],
  upperLeft: [21, 22, 23, 24, 25, 26, 27, 28],
  lowerLeft: [31, 32, 33, 34, 35, 36, 37, 38],
  lowerRight: [48, 47, 46, 45, 44, 43, 42, 41]
};

export const PRIMARY_QUADRANTS = {
  upperRight: [55, 54, 53, 52, 51],
  upperLeft: [61, 62, 63, 64, 65],
  lowerLeft: [71, 72, 73, 74, 75],
  lowerRight: [85, 84, 83, 82, 81]
};

/**
 * Chart rows as seen by the clinician facing the patient:
 *   upper: 18 … 11 | 21 … 28
 *   lower: 48 … 41 | 31 … 38
 */
export const ADULT_CHART_ROWS = [
  [...ADULT_QUADRANTS.upperRight, ...ADULT_QUADRANTS.upperLeft],
  [...ADULT_QUADRANTS.lowerRight, ...ADULT_QUADRANTS.lowerLeft]
];
export const PRIMARY_CHART_ROWS = [
  [...PRIMARY_QUADRANTS.upperRight, ...PRIMARY_QUADRANTS.upperLeft],
  [...PRIMARY_QUADRANTS.lowerRight, ...PRIMARY_QUADRANTS.lowerLeft]
];

export const ADULT_TEETH = ADULT_CHART_ROWS.flat();
export const PRIMARY_TEETH = PRIMARY_CHART_ROWS.flat();

// Legacy v1.4.0–v1.6.1 chart position index (1-based) → FDI. Used only by the
// layout-2 migration that canonicalises historical rows.
export const ADULT_POSITION_TO_FDI = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 38, 37, 36, 35, 34, 33, 32, 31, 48, 47, 46, 45, 44, 43, 42, 41];
export const PRIMARY_POSITION_TO_FDI = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 75, 74, 73, 72, 71, 81, 82, 83, 84, 85];

const ADULT_SET = new Set(ADULT_TEETH);
const PRIMARY_SET = new Set(PRIMARY_TEETH);

export function isValidFdi(tooth, dentition = 'adult') {
  const value = Number(tooth);
  if (!Number.isInteger(value)) return false;
  return dentition === 'primary' ? PRIMARY_SET.has(value) : ADULT_SET.has(value);
}

/** Dentition implied by an FDI code, or '' when it is not a valid code. */
export function dentitionOf(tooth) {
  const value = Number(tooth);
  if (ADULT_SET.has(value)) return 'adult';
  if (PRIMARY_SET.has(value)) return 'primary';
  return '';
}

const QUADRANT_NAMES = { 1: 'upper right', 2: 'upper left', 3: 'lower left', 4: 'lower right', 5: 'upper right', 6: 'upper left', 7: 'lower left', 8: 'lower right' };
const ADULT_TOOTH_NAMES = { 1: 'central incisor', 2: 'lateral incisor', 3: 'canine', 4: 'first premolar', 5: 'second premolar', 6: 'first molar', 7: 'second molar', 8: 'third molar' };
const PRIMARY_TOOTH_NAMES = { 1: 'central incisor', 2: 'lateral incisor', 3: 'canine', 4: 'first molar', 5: 'second molar' };

/** Human description, e.g. 36 → "Lower left first molar". */
export function toothName(tooth) {
  const value = Number(tooth);
  const dentition = dentitionOf(value);
  if (!dentition) return '';
  const quadrant = Math.floor(value / 10);
  const position = value % 10;
  const name = (dentition === 'primary' ? PRIMARY_TOOTH_NAMES : ADULT_TOOTH_NAMES)[position];
  const text = `${QUADRANT_NAMES[quadrant]} ${dentition === 'primary' ? 'primary ' : ''}${name}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const TOOTH_STATUSES = ['Healthy', 'Caries', 'Restored', 'Crown', 'Root canal', 'Bridge', 'Implant', 'Missing', 'Extracted', 'Fractured', 'Watch'];
