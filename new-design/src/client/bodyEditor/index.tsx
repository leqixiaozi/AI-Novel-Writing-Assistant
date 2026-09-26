import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Editor} from '@tiptap/core';
import {BubbleMenuPlugin} from '@tiptap/extension-bubble-menu';
import StarterKit from '@tiptap/starter-kit';
import {Fragment,Slice} from '@tiptap/pm/model';
import {bodyDocument,bodyText,bodySelection,selectionStillValid,type BodyNode,type BodySelectionSnapshot} from './model';
import './body-editor.css';
export interface BodyEditorHandle {getSelection:()=>{start:number;end:number}|null;focus:()=>void;}
export interface BodyEditorAction {id:string;label:string;onRun:(selection:BodySelectionSnapshot)=>void;}
interface Props {value:string;onChange:(value:string)=>void;disabled?:boolean;actions?:BodyEditorAction[];}
/** No HTML round trip, alternate body table, AI invocation, or automatic adoption. */
const BodyEditor=forwardRef<BodyEditorHandle,Props>(function BodyEditor({value,onChange,disabled=false,actions=[]},ref){
  const revision=useRef(0),lastSelection=useRef<{from:number;to:number;revision:number}|null>(null),onChangeRef=useRef(onChange);onChangeRef.current=onChange;
  const [dialog,setDialog]=useState<BodySelectionSnapshot|null>(null),[replacement,setReplacement]=useState(''),[failure,setFailure]=useState(''),[,render]=useState(0);const textarea=useRef<HTMLTextAreaElement>(null);
  const host=useRef<HTMLDivElement>(null),dialogRef=useRef(dialog),disabledRef=useRef(disabled);
  dialogRef.current=dialog;disabledRef.current=disabled;
  const [bubbleElement]=useState(()=>document.createElement('div'));
  const [editor,setEditor]=useState<Editor|null>(null);
  useEffect(()=>{
    if(!host.current)return;
    const current=new Editor({
      element:host.current,
      extensions:[StarterKit.configure({bold:false,italic:false,strike:false,underline:false,code:false,codeBlock:false,heading:false,blockquote:false,bulletList:false,orderedList:false,listItem:false,listKeymap:false,horizontalRule:false,link:false,trailingNode:false})],
      content:bodyDocument(value),editable:!disabledRef.current,
      editorProps:{attributes:{role:'textbox','aria-label':'章节正文','aria-multiline':'true',spellcheck:'false'}},
      onUpdate:({editor:updated})=>{revision.current++;lastSelection.current=null;try{onChangeRef.current(bodyText(updated.getJSON() as BodyNode));setFailure('');}catch(error){setFailure(error instanceof Error?error.message:'正文内容无法转换，未保存。');}render(version=>version+1);},
      // Dragging over a long chapter stores positions only; freeze the document on action.
      onSelectionUpdate:({editor:updated})=>{if(updated.view.composing)return;const {from,to}=updated.state.selection;lastSelection.current=from<to?{from,to,revision:revision.current}:null;},
    });
    bubbleElement.style.visibility='hidden';
    bubbleElement.className='nd-body-bubble';
    bubbleElement.setAttribute('role','toolbar');
    bubbleElement.setAttribute('aria-label','选中文字');
    current.registerPlugin(BubbleMenuPlugin({pluginKey:'bodyBubbleMenu',editor:current,element:bubbleElement,shouldShow:({editor:active,from,to})=>!disabledRef.current&&!dialogRef.current&&!active.view.composing&&from<to,options:{placement:'top',offset:8}}));
    setEditor(current);
    return()=>{current.destroy();bubbleElement.remove();};
  },[]);
  useEffect(()=>{if(!editor)return;editor.setEditable(!disabled,false);},[editor,disabled]);
  useEffect(()=>{if(editor&&(disabled||dialog))editor.view.dispatch(editor.state.tr.setMeta('bodyBubbleMenu','hide'));},[editor,disabled,dialog]);
  useEffect(()=>{if(!editor||bodyText(editor.getJSON() as BodyNode)===value)return;
    revision.current++;lastSelection.current=null;editor.commands.setContent(bodyDocument(value),{emitUpdate:false});
    if(dialog)setFailure('正文来源已变化。保留修改输入；请关闭对话框，重新选择要修改的范围。');
  },[editor,value,dialog]);
  useImperativeHandle(ref,()=>({focus:()=>{editor?.commands.focus();},getSelection:()=>{if(!editor)return null;const current=lastSelection.current;if(!current||current.revision!==revision.current)return null;const frozen=bodySelection(editor.getJSON() as BodyNode,current.from,current.to,revision.current);return frozen?{start:frozen.start,end:frozen.end}:null;}}),[editor]);
  useEffect(()=>{if(dialog)textarea.current?.focus();},[dialog]);
  function snapshot(){if(!editor||disabled||editor.view.composing)return null;const {from,to}=editor.state.selection;return bodySelection(editor.getJSON() as BodyNode,from,to,revision.current);}
  function open(){const selected=snapshot();if(!selected){setFailure('请先选中需要修改的正文，支持词句和跨段文字。');return;}setDialog(selected);setReplacement(selected.text);setFailure('');}
  function close(){setDialog(null);setFailure('');if(editor)editor.commands.focus();}
  function replace(){if(!editor||!dialog||disabled||editor.view.composing)return;
    const document=editor.getJSON() as BodyNode;
    if(!selectionStillValid(dialog,document,revision.current)){setFailure('正文在选中后发生变化，未替换任何内容。请保留输入，重新选中原文。');return;}
    try{const nodes=(bodyDocument(replacement).content??[]).map(node=>editor.schema.nodeFromJSON(node));
      const transaction=editor.state.tr.replaceRange(dialog.from,dialog.to,new Slice(Fragment.fromArray(nodes),1,1));
      const expected=bodyText(document).slice(0,dialog.start)+replacement+bodyText(document).slice(dialog.end);
      if(bodyText(transaction.doc.toJSON() as BodyNode)!==expected)throw new Error('目标段落边界无法安全替换，未改变正文。请缩小选区后重试。');
      editor.view.dispatch(transaction.scrollIntoView());setDialog(null);setFailure('');editor.commands.focus();
    }catch(error){setFailure(error instanceof Error?error.message:'替换未完成，原正文与修改输入保留。');}
  }
  return <div className='nd-body-editor'>
    <div className='nd-body-toolbar' role='toolbar' aria-label='正文编辑'><button type='button' disabled={!editor||disabled||!editor.can().undo()} onClick={()=>editor?.chain().focus().undo().run()}>撤销</button><button type='button' disabled={!editor||disabled||!editor.can().redo()} onClick={()=>editor?.chain().focus().redo().run()}>重做</button><button type='button' disabled={!editor||disabled} onClick={()=>editor?.chain().focus().selectAll().run()}>选择全文</button><button type='button' disabled={!editor||disabled} onMouseDown={event=>event.preventDefault()} onClick={open}>修改所选文字</button></div>
    <div ref={host}/>
    {createPortal(<><button type='button' onMouseDown={event=>event.preventDefault()} onClick={open}>修改选区</button>{actions.map(action=><button type='button' key={action.id} onMouseDown={event=>event.preventDefault()} onClick={()=>{const selected=snapshot();if(selected)action.onRun(selected);}}>{action.label}</button>)}</>,bubbleElement)}
    {failure&&!dialog&&<p role='alert' className='nd-message is-error'>{failure}</p>}
    {dialog&&<div className='nd-body-modal' role='dialog' aria-modal='true' aria-labelledby='body-selection-title' onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){
        const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),summary'));
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }}><section>
      <h2 id='body-selection-title'>修改所选文字</h2>
      <p>仅替换下面选中的范围，其他正文保留；确认后可撤销。关闭对话框会放弃此次未确认输入。</p>
      {failure&&<p role='alert' className='nd-message is-error'>{failure}</p>}
      <details><summary>查看原选区</summary><pre>{dialog.text}</pre></details>
      <label>修改内容<textarea ref={textarea} value={replacement} disabled={disabled} onChange={event=>setReplacement(event.target.value)}/></label>
      <div className='nd-row-actions'><button type='button' onClick={close}>取消修改</button><button type='button' disabled={disabled} onClick={replace}>确认替换选区</button></div>
    </section></div>}
  </div>;
});
export default BodyEditor;
