export interface Migration {
  id: string;
  fileName: string;
}

export const migrations: Migration[] = [
  {
    id: "001_card_kernel",
    fileName: "001_card_kernel.sql",
  },
  {
    id: "002_builtin_novel_cards",
    fileName: "002_builtin_novel_cards.sql",
  },
  {
    id: "003_novel_card_catalog",
    fileName: "003_novel_card_catalog.sql",
  },
  {
    id: "004_xianxia_production_demo",
    fileName: "004_xianxia_production_demo.sql",
  },
  {
    id: "005_card_composition_kernel",
    fileName: "005_card_composition_kernel.sql",
  },
  {
    id: "006_template_books",
    fileName: "006_template_books.sql",
  },
  {
    id: "007_unified_book_creation",
    fileName: "007_unified_book_creation.sql",
  },
  {
    id: "008_card_type_categories",
    fileName: "008_card_type_categories.sql",
  },
  {
    id: "009_strategy_resources",
    fileName: "009_strategy_resources.sql",
  },
  {
    id: "010_prompt_components",
    fileName: "010_prompt_components.sql",
  },
  {
    id: "011_book_multiview",
    fileName: "011_book_multiview.sql",
  },
];
