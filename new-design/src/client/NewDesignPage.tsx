import BookWorkspacePage from "./BookWorkspacePage";
import BooksPage from "./BooksPage";
import CreateBookPage from "./CreateBookPage";
import CardTypeCatalogPage from "./CardTypeCatalogPage";
import DictionaryRelationsPage from "./DictionaryRelationsPage";
import FormDesignerPage from "./FormDesignerPage";
import NewDesignLanding from "./NewDesignLanding";
import ResourceCenterPage from "./ResourceCenterPage";
import StrategyResourcesPage from "./StrategyResourcesPage";
import TemplateGroupsPage from "./TemplateGroupsPage";
import "./new-design.css";

interface NewDesignPageProps { pathname?:string; }

export default function NewDesignPage({pathname}:NewDesignPageProps) {
  const path=(pathname??window.location.pathname).replace(/\/+$/,"")||"/new-design";
  if(path==="/new-design")return <NewDesignLanding/>;
  if(path==="/new-design/books")return <BooksPage/>;
  if(path==="/new-design/books/new")return <CreateBookPage/>;
  if(path==="/new-design/resources")return <ResourceCenterPage/>;
  if(path==="/new-design/resources/strategies")return <StrategyResourcesPage/>;
  const bookMatch=path.match(/^\/new-design\/books\/([^/]+)(?:\/(forms|cards|fields))?$/);
  if(bookMatch)return <BookWorkspacePage bookId={decodeURIComponent(bookMatch[1])} view={(bookMatch[2] as "forms"|"cards"|"fields"|undefined)??"forms"}/>;
  if(path==="/new-design/structure/card-types")return <CardTypeCatalogPage/>;
  if(path==="/new-design/structure/dictionaries-relations")return <DictionaryRelationsPage/>;
  if(path==="/new-design/structure/forms")return <FormDesignerPage/>;
  if(path==="/new-design/structure/templates")return <TemplateGroupsPage/>;
  return <div className="nd-shell nd-fatal"><p className="nd-kicker">新设计</p><h1>页面不存在</h1><p>此地址不在当前书籍与结构设计中心层级中。</p><a className="nd-button nd-button-primary" href="/new-design">返回新设计首页</a></div>;
}
