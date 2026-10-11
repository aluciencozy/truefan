import { useEffect, useState } from 'react'
import { ReactFlow, Background, Controls, Handle, Position, applyNodeChanges } from '@xyflow/react'
import type { Connection, Node, NodeProps } from '@xyflow/react'
import type { EntryDraft, ForumEntry } from '../lib/community'
import '@xyflow/react/dist/style.css'
type ClueNode = Node<{ label: string; source: string; shape: string; editable: boolean }, 'clue'>
function ClueShape({ data }: NodeProps<ClueNode>) {
  return <div className={`detective-clue detective-${data.shape}`}><Handle type="target" position={Position.Left} /><strong>{data.label}</strong><small>{data.source}</small><Handle type="source" position={Position.Right} isConnectable={data.editable} /></div>
}
const nodeTypes = { clue: ClueShape }
export function clueDraft(e: ForumEntry): EntryDraft {
  return {kind:e.kind,body:e.body,side:e.side,source:e.source,artwork:e.artwork,connects_to:e.connects_to,contains_spoilers:e.contains_spoilers,board_x:e.board_x,board_y:e.board_y,shape:e.shape || 'rectangle'}
}
export default function DetectiveBoard({ clues, busy, onSave }: {clues:ForumEntry[];busy:boolean;onSave:(entry:ForumEntry,draft:EntryDraft)=>Promise<void>}) {
  const [nodes,setNodes]=useState<ClueNode[]>([])
  useEffect(()=>{setNodes(clues.map((e,i)=>({id:e.id,type:'clue',position:{x:e.board_x??(i%3)*290,y:e.board_y??Math.floor(i/3)*190},draggable:e.is_owner&&!busy,connectable:!busy,data:{label:e.body,source:e.source,shape:e.shape||'rectangle',editable:e.is_owner&&!busy}})))},[clues,busy])
  async function connect(c:Connection) {const e=clues.find(e=>e.id===c.source);if(e?.is_owner&&c.target!==e.id&&!busy)await onSave(e,{...clueDraft(e),connects_to:c.target})}
  return <div className="detective-board-wrapper"><p>Drag your shapes to arrange clues. Draw a line from your clue’s right dot to another clue’s left dot. Choose a shape or remove a connection in the clue form.</p><div className="detective-board" aria-label="Editable detective board"><ReactFlow<ClueNode> nodes={nodes} nodeTypes={nodeTypes} edges={clues.filter(e=>e.connects_to&&clues.some(t=>t.id===e.connects_to)).map(e=>({id:e.id,source:e.id,target:e.connects_to!,type:'straight'}))}
    onNodesChange={changes=>setNodes(current=>applyNodeChanges(changes,current))}
    onNodeDragStop={(_,node)=>{const e=clues.find(e=>e.id===node.id);if(e?.is_owner&&!busy)void onSave(e,{...clueDraft(e),board_x:node.position.x,board_y:node.position.y})}} onConnect={c=>void connect(c)} fitView minZoom={0.2} maxZoom={2} deleteKeyCode={null}><Background/><Controls showInteractive={false}/></ReactFlow></div>{!clues.length&&<p>Add your first clue below to start the board.</p>}</div>
}
