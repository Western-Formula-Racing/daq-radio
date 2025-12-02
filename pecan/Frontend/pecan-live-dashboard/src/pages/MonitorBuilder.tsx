import React, { useState, useRef, useCallback } from 'react';
import ReactFlow, {
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  Controls,
  Background,
  Handle,
  Position,
  ConnectionMode,
  type Connection,
  type Edge,
  type NodeTypes,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useSignal, useAllSignals } from '../lib/useDataStore';

// Custom Node Component
const SensorNode = ({ data }: { data: { msgID: string; signalName: string } }) => {
  const signalData = useSignal(data.msgID, data.signalName);

  return (
    <div className="relative p-4 rounded-md shadow-lg bg-data-module-bg border border-gray-600 text-white min-w-[180px] max-w-[250px]">
      <Handle type="source" position={Position.Top} id="top" className="!bg-white w-4 h-4" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-white w-4 h-4" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-white w-4 h-4" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-white w-4 h-4" />
      
      <div className="text-sm font-semibold truncate">{data.signalName}</div>
      <div className="text-xs text-gray-400">{data.msgID}</div>
      <div className="mt-2 text-lg font-bold text-green-400">
        {signalData ? `${signalData.sensorReading} ${signalData.unit}` : 'N/A'}
      </div>
    </div>
  );
};

const nodeTypes: NodeTypes = {
  sensor: SensorNode,
};

const MonitorBuilder = () => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  
  const allSignals = useAllSignals();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSignals = allSignals.filter((signal) => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase();
    const terms = lowerQuery.split(' ').filter((t) => t.length > 0);
    const signalNameLower = signal.signalName.toLowerCase();
    const msgIDLower = signal.msgID.toLowerCase();
    const searchTarget = `${signalNameLower} ${msgIDLower}`;
    return terms.every((term) => searchTarget.includes(term));
  });

  const onConnect = useCallback(
    (params: Connection | Edge) => setEdges((eds) => addEdge({ ...params, type: 'smoothstep', pathOptions: { borderRadius: 10 }, animated: true, style: { stroke: '#fff', strokeDasharray: '5 5' } }, eds)),
    [setEdges]
  );

  const onEdgeDoubleClick = useCallback(
    (event: React.MouseEvent, edge: Edge) => {
      event.stopPropagation();
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
    },
    [setEdges]
  );

  const onDragStart = (event: React.DragEvent, nodeType: string, msgID: string, signalName: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/msgID', msgID);
    event.dataTransfer.setData('application/signalName', signalName);
    event.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      const type = event.dataTransfer.getData('application/reactflow');
      const msgID = event.dataTransfer.getData('application/msgID');
      const signalName = event.dataTransfer.getData('application/signalName');

      // check if the dropped element is valid
      if (typeof type === 'undefined' || !type || !reactFlowBounds || !reactFlowInstance) {
        return;
      }

      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      const newNode = {
        id: `${type}-${msgID}-${signalName}-${Date.now()}`,
        type,
        position,
        data: { msgID, signalName },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  return (
    <div className="flex h-full w-full bg-sidebar text-white">
        <ReactFlowProvider>
            {/* Sidebar for Drag and Drop */}
            <div className="w-64 bg-data-module-bg p-4 flex flex-col gap-2 overflow-y-auto border-r border-gray-700">
                <h2 className="text-xl font-bold mb-4">Available Signals</h2>
                
                <input
                    type="text"
                    placeholder="Search signals..."
                    className="w-full p-2 mb-2 bg-data-textbox-bg rounded text-white focus:outline-none focus:ring-1 focus:ring-blue-500 border border-gray-600 text-sm"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />

                <div className="text-xs text-gray-400 mb-2">Drag to canvas</div>
                {filteredSignals.map((signal, index) => (
                    <div
                        key={`${signal.msgID}-${signal.signalName}-${index}`} // Use a unique key
                        className="p-2 bg-data-textbox-bg rounded cursor-grab hover:bg-data-textbox-bg/80 transition-colors"
                        onDragStart={(event) => onDragStart(event, 'sensor', signal.msgID, signal.signalName)}
                        draggable
                    >
                        <span className="font-semibold">{signal.signalName}</span> <span className="text-gray-400 text-xs">({signal.msgID})</span>
                    </div>
                ))}
                {filteredSignals.length === 0 && (
                    <div className="text-gray-500 italic">No signals found</div>
                )}
            </div>

            {/* Main Canvas */}
            <div className="flex-1 h-full" ref={reactFlowWrapper}>
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onEdgeDoubleClick={onEdgeDoubleClick}
                    onInit={setReactFlowInstance}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    nodeTypes={nodeTypes}
                    connectionMode={ConnectionMode.Loose}
                    fitView
                    className="bg-sidebar"
                >
                    <Controls />
                    <Background color="#444" gap={16} />
                </ReactFlow>
            </div>
        </ReactFlowProvider>
    </div>
  );
};

export default MonitorBuilder;
