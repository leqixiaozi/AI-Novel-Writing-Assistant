import {useId,useState,type ReactNode} from 'react';
export default function Help({label,children}:{label:string;children:ReactNode}) {
 const id=useId(),[open,setOpen]=useState(false);
 return <span className={`nd-story-help${open?' is-open':''}`}><button type="button" aria-label={`${label}帮助`} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);}}>?</button><span className="nd-story-help-content" id={id} role="note">{children}</span></span>;
}
