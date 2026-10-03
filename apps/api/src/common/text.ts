// PostgreSQL text columns reject the null character
export const removeNullBytes = (text: string) => text.replaceAll('\u0000', '');
