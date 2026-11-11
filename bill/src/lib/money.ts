/** Money is integer paise everywhere inside this service; rupees only at the edges. */
export const Paise = (rupees: number): number => {
  if (!Number.isFinite(rupees)) throw new Error(`Not a number: ${rupees}`);
  return Math.round(rupees * 100);
};

export const toRupees = (paise: number): number => paise / 100;

export const rupeeString = (paise: number): string => (paise / 100).toFixed(2);

export const formatINR = (paise: number): string =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const sumPaise = (values: number[]): number => values.reduce((total, value) => total + value, 0);
