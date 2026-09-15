export interface Migration {
  id: string;
  fileName: string;
}

export const migrations: Migration[] = [
  {
    id: "001_card_kernel",
    fileName: "001_card_kernel.sql",
  },
];
