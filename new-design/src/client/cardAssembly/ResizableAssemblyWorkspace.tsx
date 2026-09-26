import {useEffect,useRef,useState,type KeyboardEvent,type PointerEvent as ReactPointerEvent,type ReactNode} from 'react';
import './assembly.css';

export default function ResizableAssemblyWorkspace({children}:{children:ReactNode}){
  const host=useRef<HTMLDivElement>(null);
  const [left,setLeft]=useState(220),[right,setRight]=useState(286);
  const [leftClosed,setLeftClosed]=useState(false),[rightClosed,setRightClosed]=useState(false);
  const drag=useRef<{side:'left'|'right';start:number;width:number}|null>(null);
  useEffect(()=>{
    function move(event:PointerEvent){if(!drag.current||!host.current)return;const {side,start,width}=drag.current,available=host.current.clientWidth;
      const next=Math.max(170,Math.min(Math.max(170,available*.42),width+(side==='left'?event.clientX-start:start-event.clientX)));
      if(side==='left')setLeft(next);else setRight(next);
    }
    function stop(){drag.current=null}
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);
    return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop)};
  },[]);
  function start(side:'left'|'right',event:ReactPointerEvent){event.preventDefault();drag.current={side,start:event.clientX,width:side==='left'?left:right}}
  function key(side:'left'|'right',event:KeyboardEvent){if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();const delta=event.key==='ArrowRight'?20:-20;if(side==='left')setLeft(Math.max(170,left+delta));else setRight(Math.max(170,right-delta))}
  return <div ref={host} className={`nd-assembly-workspace nd-assembly-resizable ${leftClosed?'left-closed':''} ${rightClosed?'right-closed':''}`} style={{gridTemplateColumns:`${leftClosed?32:left}px minmax(0,1fr) ${rightClosed?32:right}px`}}>
    {children}
    <div className="nd-assembly-divider left" style={{left:leftClosed?32:left}} role="separator" aria-label="调整左栏宽度" aria-orientation="vertical" tabIndex={0} onPointerDown={event=>start('left',event)} onKeyDown={event=>key('left',event)}><button type="button" aria-label={leftClosed?'展开左栏':'收起左栏'} onPointerDown={event=>event.stopPropagation()} onClick={()=>setLeftClosed(value=>!value)}>{leftClosed?'›':'‹'}</button></div>
    <div className="nd-assembly-divider right" style={{right:rightClosed?32:right}} role="separator" aria-label="调整右栏宽度" aria-orientation="vertical" tabIndex={0} onPointerDown={event=>start('right',event)} onKeyDown={event=>key('right',event)}><button type="button" aria-label={rightClosed?'展开右栏':'收起右栏'} onPointerDown={event=>event.stopPropagation()} onClick={()=>setRightClosed(value=>!value)}>{rightClosed?'‹':'›'}</button></div>
  </div>;
}
