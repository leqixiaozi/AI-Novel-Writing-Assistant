export interface Migration {id:string;fileName:string;}
/** New installations use one complete pure-table baseline, not historical upgrades. */
export const migrations:Migration[]=[
 {id:"132_card_kernel_tables_only",fileName:"132_card_kernel_tables_only.sql"},
];
