import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import { getNewDesignPool as getRuntimePool } from "../runtime";

// The editing command owns the physical transaction. Legacy chapter settlement
// functions are reused inside it without opening a second connection or committing
// halfway through a command. The context is private to this business module.
const scope = new AsyncLocalStorage<PoolClient>();
const databaseScope = new AsyncLocalStorage<Pool>();
/** Infrastructure-only injection: HTTP accepts neither pools nor namespaces. */
export function withSettlementDatabasePool<T>(pool:Pool,action:()=>Promise<T>):Promise<T>{return databaseScope.run(pool,action);}
export function settlementTransactionClient(): PoolClient | undefined { return scope.getStore(); }
export async function inSettlementTransaction<T>(client: PoolClient, action: () => Promise<T>): Promise<T> {
  return scope.run(client, action);
}
export async function getNewDesignPool(): Promise<Pool> {
  const client = scope.getStore();
  if (!client) return databaseScope.getStore()??getRuntimePool();
  const nested = new Proxy(client, {
    get(target, key) {
      if (key === "release") return () => undefined;
      if (key === "query") return async (sql: unknown, values?: unknown[]) => {
        if (typeof sql === "string" && ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql.trim().toUpperCase()))
          return { rows: [], rowCount: 0, command: sql, oid: 0, fields: [] };
        return target.query(sql as string, values);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { query: client.query.bind(client), connect: async () => nested } as unknown as Pool;
}
