import {createElement,lazy,type ComponentProps} from "react";
const LazyNewDesignPage=lazy(()=>import("./NewDesignPage"));
// Hosts may lazy-load this package too; their resolved default must be a component function.
export default function NewDesignPage(props:ComponentProps<typeof LazyNewDesignPage>) {
  return createElement(LazyNewDesignPage,props);
}
export {
  BOOK_TASK_NAV,
  CUSTOMER_TERMS,
  NEW_DESIGN_ADVANCED_NAV,
  NEW_DESIGN_PRIMARY_NAV,
  isNewDesignAdvancedPath,
  isNewDesignBookWorkspacePath,
  newDesignCurrentMenuHref,
  type BookTaskNavKey,
} from "./navigation";
