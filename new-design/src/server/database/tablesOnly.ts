import type {Pool} from 'pg';

export const TABLES_ONLY_MIGRATION='132_card_kernel_tables_only';
export const TABLES_ONLY_UPGRADE_MIGRATION='133_card_kernel_tables_only_upgrade';

/** Service startup is read-only: an old installation must never be auto-converted. */
export async function requireTablesOnlyInstallation(pool:Pick<Pool,'query'>):Promise<number>{
 const found=(await pool.query("SELECT to_regclass('new_design.schema_migrations') IS NOT NULL ledger,to_regclass('new_design.system_capabilities') IS NOT NULL capability")).rows[0];
 if(found?.ledger!==true||found.capability!==true)throw new Error('新版纯表结构尚未就绪。请在运行维护核对开发库的增量升级前提并完成明确授权的升级；服务启动不会自动迁移、重建或清空数据。');
 const row=(await pool.query(`SELECT
  EXISTS(SELECT 1 FROM new_design.schema_migrations WHERE id IN ($1,$2)) installed,
  EXISTS(SELECT 1 FROM new_design.system_capabilities WHERE capability_key='card_kernel_v2' AND installed AND operational AND details->>'storage'='tables_only') ready,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design' AND c.relkind IN('r','p')) application_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='new_design_projection' AND c.relkind IN('r','p')) projection_tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('new_design','new_design_projection') AND c.relkind IN('v','m')) views,
  to_regnamespace('new_design_compat') IS NOT NULL compatibility_schema`,[TABLES_ONLY_MIGRATION,TABLES_ONLY_UPGRADE_MIGRATION])).rows[0];
 if(row?.installed!==true||row.ready!==true||Number(row.application_tables)!==79||Number(row.projection_tables)!==4||row.views==null||Number(row.views)!==0||row.compatibility_schema!==false)throw new Error('新版需要真实的纯表基线或增量升级账本、完整的 79 表、4 张 AGE 投影表及零业务视图结构；当前库尚未满足，服务已停止写入。请到运行维护核对开发库增量升级，不会自动迁移、重建或清空数据。');
 return 1;
}
