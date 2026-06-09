export const formatCOP = (value: number) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

export const parseCOP = (value: string): number => {
  const numericString = value.replace(/[^0-9]/g, '');
  return parseInt(numericString, 10) || 0;
};

export const formatInputCOP = (value: string | number): string => {
  if (value === '' || value === 0 || value === '0') return '';
  const numericString = String(value).replace(/[^0-9]/g, '');
  const num = parseInt(numericString, 10);
  if (isNaN(num)) return '';
  return new Intl.NumberFormat('es-CO').format(num);
};
