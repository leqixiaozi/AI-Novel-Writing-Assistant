import type { ReactNode } from "react";

/** Compatibility host for existing isolated fixtures. The application uses AppLayout. */
export default function BookArrangementShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
